package parser

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/raphaelrong/on-that-day/internal/model"
)

var (
	dateLineRe = regexp.MustCompile(`(?i)^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d+)(?:st|nd|rd|th)\.\s*(.*)$`)
	monthNames = map[string]int{
		"January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
		"July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
	}
	// Flexible regex for lat/lng with optional minutes/seconds and N/S/E/W indicators.
	// Supports: "Latitude of 37", "Latitude, by observation, 38", degrees/° symbol,
	// minutes/min/'/′, seconds/sec/"/″, case-insensitive. The [^\d]{0,60} guard
	// prevents greedily latching onto a distant number in a different clause.
	latRe = regexp.MustCompile(`(?i)latitude[^\d]{0,30}(\d+)\s*(?:degrees?|°)?\s*(?:(\d+)\s*(?:minutes?|min\.?|′|')?\s*(?:(\d+)\s*(?:seconds?|sec\.?|″|")?)?)?\s*(North|South|N|S)?`)
	lngRe = regexp.MustCompile(`(?i)longitude[^\d]{0,30}(\d+)\s*(?:degrees?|°)?\s*(?:(\d+)\s*(?:minutes?|min\.?|′|')?\s*(?:(\d+)\s*(?:seconds?|sec\.?|″|")?)?)?\s*(East|West|E|W)?`)
)

// VoyageAuthor holds metadata for a parsed voyage log.
type VoyageAuthor struct {
	Key            string
	Name           string
	Born           string
	Source         string
	Note           string
	StartYear      int // optional: defaults to 1768
	StartMonth     int // optional: defaults to 1
	DefaultLatSign int // optional: +1 for North, -1 for South; defaults to +1
	DefaultLngSign int // optional: +1 for East, -1 for West; defaults to +1
}

// Voyage holds the parsed author and chronological entries.
type Voyage struct {
	Author  model.Author
	Entries []model.Entry
}

type coordDir struct {
	latMissing bool
	lngMissing bool
}

type parsedEntry struct {
	entry model.Entry
	dirs  coordDir
}

type coordMatch struct {
	groups []string
	start  int
	end    int
}

// ParseVoyageLog parses a Project Gutenberg-style captain's log into daily entries.
func ParseVoyageLog(path string, author VoyageAuthor) (*Voyage, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open log: %w", err)
	}
	defer f.Close()

	v := &Voyage{
		Author: model.Author{
			Key:    author.Key,
			Name:   author.Name,
			Born:   author.Born,
			Source: author.Source,
			Note:   author.Note,
			Type:   model.AuthorTypeVoyage,
		},
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	var current *model.Entry
	year := author.StartYear
	if year == 0 {
		year = 1768
	}
	month := author.StartMonth
	if month == 0 {
		month = 1
	}
	day := 1

	var parsed []parsedEntry

	flush := func() {
		if current == nil {
			return
		}
		lat, lng, latMissing, lngMissing, ok := extractPosition(current.Text, author.DefaultLatSign, author.DefaultLngSign)
		if ok {
			current.Lat = lat
			current.Lng = lng
			current.Place = extractPlace(current.Text)
			parsed = append(parsed, parsedEntry{entry: *current, dirs: coordDir{latMissing: latMissing, lngMissing: lngMissing}})
		}
		current = nil
	}

	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		m := dateLineRe.FindStringSubmatch(line)
		if m == nil {
			if current != nil {
				current.Text += "\n" + line
			}
			continue
		}

		// New day begins.
		flush()

		monthName := m[2]
		dayNum, _ := strconv.Atoi(m[3])
		text := m[4]

		newMonth := month
		explicit := false
		if monthName != "" {
			// Normalise month name for lookup (e.g., "april" or "April").
			monthName = strings.Title(strings.ToLower(monthName))
			newMonth = monthNames[monthName]
			explicit = true
		}

		if explicit {
			// Explicit month. If it rolls backward, advance year.
			if newMonth < month {
				year++
			}
		} else {
			// No month given: if the day number drops, assume we advanced a month.
			if dayNum < day {
				newMonth = month + 1
				if newMonth > 12 {
					newMonth = 1
					year++
				}
			}
		}
		month = newMonth
		day = dayNum

		current = &model.Entry{
			Year:  year,
			Month: month,
			Day:   day,
			Text:  text,
		}
	}
	flush()

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan log: %w", err)
	}

	// Sort chronologically just in case.
	sort.Slice(parsed, func(i, j int) bool {
		ti := time.Date(parsed[i].entry.Year, time.Month(parsed[i].entry.Month), parsed[i].entry.Day, 0, 0, 0, 0, time.UTC)
		tj := time.Date(parsed[j].entry.Year, time.Month(parsed[j].entry.Month), parsed[j].entry.Day, 0, 0, 0, 0, time.UTC)
		return ti.Before(tj)
	})

	// Infer missing N/S/E/W signs from neighbouring entries that have explicit
	// directions. This fixes cases like "latitude 31 degrees 17 minutes" near
	// Madeira, where the default Southern Hemisphere sign would be wrong.
	inferMissingSigns(parsed)
	parsed = removeRouteOutliers(parsed)

	for _, pe := range parsed {
		v.Entries = append(v.Entries, pe.entry)
	}

	return v, nil
}

func extractPosition(text string, defaultLatSign, defaultLngSign int) (lat, lng float64, latMissing, lngMissing bool, ok bool) {
	latMatches := collectCoordMatches(latRe, text)
	lngMatches := collectCoordMatches(lngRe, text)
	if len(latMatches) == 0 || len(lngMatches) == 0 {
		return 0, 0, false, false, false
	}

	// Skip relative positions like "Longitude 2 degrees 20 minutes East from Cape West"
	// or "Longitude made from Cape Farewell 11 degrees 34 minutes West". These are
	// offsets from a local landmark, not absolute Greenwich coordinates.
	filterRelative := func(matches []coordMatch) []coordMatch {
		out := make([]coordMatch, 0, len(matches))
		for _, m := range matches {
			end := m.end
			tailEnd := end + 30
			if tailEnd > len(text) {
				tailEnd = len(text)
			}
			tail := strings.ToLower(text[end:tailEnd])
			matchLower := strings.ToLower(m.groups[0])
			if strings.Contains(matchLower, "from") ||
				strings.Contains(matchLower, "by account") ||
				strings.Contains(tail, "from") {
				continue
			}
			out = append(out, m)
		}
		return out
	}
	latMatches = filterRelative(latMatches)
	lngMatches = filterRelative(lngMatches)
	if len(latMatches) == 0 || len(lngMatches) == 0 {
		return 0, 0, false, false, false
	}

	lm, ln, ok := pickBestPair(text, latMatches, lngMatches)
	if !ok {
		return 0, 0, false, false, false
	}

	lat, latMissing = parseCoord(lm.groups[1], lm.groups[2], lm.groups[3], lm.groups[4], defaultLatSign)
	lng, lngMissing = parseCoord(ln.groups[1], ln.groups[2], ln.groups[3], ln.groups[4], defaultLngSign)
	lng = normalizeLng(lng)
	return lat, lng, latMissing, lngMissing, true
}

func collectCoordMatches(re *regexp.Regexp, text string) []coordMatch {
	groups := re.FindAllStringSubmatch(text, -1)
	indices := re.FindAllStringSubmatchIndex(text, -1)
	out := make([]coordMatch, 0, len(groups))
	for i, g := range groups {
		out = append(out, coordMatch{groups: g, start: indices[i][0], end: indices[i][1]})
	}
	return out
}

func pickBestPair(text string, latMatches, lngMatches []coordMatch) (coordMatch, coordMatch, bool) {
	bestScore := -1 << 30
	var bestLat coordMatch
	var bestLng coordMatch
	for _, lat := range latMatches {
		for _, lng := range lngMatches {
			distance := absInt(lng.start - lat.start)
			if distance > 700 {
				continue
			}
			score := scoreCoordPair(text, lat, lng)
			if score > bestScore {
				bestScore = score
				bestLat = lat
				bestLng = lng
			}
		}
	}
	if bestScore < 80 {
		return coordMatch{}, coordMatch{}, false
	}
	return bestLat, bestLng, true
}

func scoreCoordPair(text string, lat, lng coordMatch) int {
	start := lat.start
	if lng.start < start {
		start = lng.start
	}
	end := lat.end
	if lng.end > end {
		end = lng.end
	}
	ctxStart := start - 180
	if ctxStart < 0 {
		ctxStart = 0
	}
	ctxEnd := end + 180
	if ctxEnd > len(text) {
		ctxEnd = len(text)
	}
	ctx := strings.ToLower(text[ctxStart:ctxEnd])
	pairText := strings.ToLower(text[start:end])
	score := 120 - absInt(lng.start-lat.start)/4
	if lat.start < lng.start {
		score += 30
	}
	for _, marker := range []struct {
		s string
		w int
	}{
		{"at noon", 220},
		{"noon", 140},
		{"course and distance", 180},
		{"course", 80},
		{"distance", 80},
		{"wind", 50},
		{"by observation", 140},
		{"per observation", 120},
		{"latitude observed", 160},
		{"observed", 80},
		{"brought us into", 120},
		{"ship", 30},
	} {
		if strings.Contains(ctx, marker.s) {
			score += marker.w
		}
	}
	for _, marker := range []struct {
		s string
		w int
	}{
		{"letter to", -260},
		{"sir,", -220},
		{"please to acquaint", -220},
		{"remarks", -120},
		{"lies in", -140},
		{"situate in", -140},
		{"latitude and longitude of which", -180},
		{"which i found to be", -130},
		{"i named", -100},
		{"bore", -40},
		{"distant", -40},
	} {
		if strings.Contains(ctx, marker.s) || strings.Contains(pairText, marker.s) {
			score += marker.w
		}
	}
	return score
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func normalizeLng(lng float64) float64 {
	for lng <= -180 {
		lng += 360
	}
	for lng > 180 {
		lng -= 360
	}
	return lng
}

func parseCoord(degStr, minStr, secStr, dir string, defaultSign int) (float64, bool) {
	deg, _ := strconv.Atoi(degStr)
	min := 0
	if minStr != "" {
		min, _ = strconv.Atoi(minStr)
	}
	sec := 0
	if secStr != "" {
		sec, _ = strconv.Atoi(secStr)
	}
	val := float64(deg) + float64(min)/60.0 + float64(sec)/3600.0
	missing := false
	switch strings.ToLower(dir) {
	case "south", "s", "west", "w":
		val = -val
	case "north", "n", "east", "e":
		// positive
	default:
		missing = true
		if defaultSign < 0 {
			val = -val
		}
	}
	return val, missing
}

func inferMissingSigns(parsed []parsedEntry) {
	if len(parsed) == 0 {
		return
	}

	// Latitude.
	for i := range parsed {
		if !parsed[i].dirs.latMissing {
			continue
		}
		prev := 0
		for j := i - 1; j >= 0; j-- {
			if !parsed[j].dirs.latMissing {
				prev = sign(parsed[j].entry.Lat)
				break
			}
		}
		next := 0
		for j := i + 1; j < len(parsed); j++ {
			if !parsed[j].dirs.latMissing {
				next = sign(parsed[j].entry.Lat)
				break
			}
		}
		if prev != 0 && prev == next {
			parsed[i].entry.Lat = math.Abs(parsed[i].entry.Lat) * float64(prev)
		}
	}

	// Longitude.
	for i := range parsed {
		if !parsed[i].dirs.lngMissing {
			continue
		}
		prev := 0
		for j := i - 1; j >= 0; j-- {
			if !parsed[j].dirs.lngMissing {
				prev = sign(parsed[j].entry.Lng)
				break
			}
		}
		next := 0
		for j := i + 1; j < len(parsed); j++ {
			if !parsed[j].dirs.lngMissing {
				next = sign(parsed[j].entry.Lng)
				break
			}
		}
		if prev != 0 && prev == next {
			parsed[i].entry.Lng = math.Abs(parsed[i].entry.Lng) * float64(prev)
		}
	}
}

func sign(x float64) int {
	if x < 0 {
		return -1
	}
	if x > 0 {
		return 1
	}
	return 0
}

func removeRouteOutliers(parsed []parsedEntry) []parsedEntry {
	if len(parsed) < 3 {
		return parsed
	}
	out := append([]parsedEntry(nil), parsed...)
	changed := true
	for changed {
		changed = false
		filtered := make([]parsedEntry, 0, len(out))
		for i := range out {
			if i == 0 || i == len(out)-1 {
				filtered = append(filtered, out[i])
				continue
			}
			prev := out[i-1].entry
			cur := out[i].entry
			next := out[i+1].entry
			if !isRouteOutlier(prev, cur, next) {
				filtered = append(filtered, out[i])
				continue
			}
			changed = true
		}
		out = filtered
	}
	return out
}

func isRouteOutlier(prev, cur, next model.Entry) bool {
	prevCur := voyageSpeed(prev, cur)
	curNext := voyageSpeed(cur, next)
	prevNext := voyageSpeed(prev, next)
	rawLng := math.Abs(cur.Lng - prev.Lng)
	shortLng := rawLng
	if shortLng > 180 {
		shortLng = 360 - shortLng
	}
	suspicious := prevCur > 300 || curNext > 300 || (rawLng > 180 && shortLng > 30)
	if !suspicious {
		return false
	}
	text := strings.ToLower(cur.Text)
	contextBad := strings.Contains(text, "letter to") ||
		strings.Contains(text, "please to acquaint") ||
		strings.Contains(text, "to return by the way of cape horn") ||
		strings.Contains(text, "latitude and longitude of which") ||
		strings.Contains(text, "situate in")
	return prevNext <= 300 || contextBad
}

func voyageSpeed(a, b model.Entry) float64 {
	days := math.Max(1, dateDays(b)-dateDays(a))
	return distanceNM(a.Lat, a.Lng, b.Lat, b.Lng) / days
}

func dateDays(e model.Entry) float64 {
	t := time.Date(e.Year, time.Month(e.Month), e.Day, 0, 0, 0, 0, time.UTC)
	return float64(t.Unix()) / 86400
}

func distanceNM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusNM = 3440.065
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	if h > 1 {
		h = 1
	}
	return 2 * earthRadiusNM * math.Asin(math.Sqrt(h))
}

var (
	landmarkRe = regexp.MustCompile(`(?i)(Cape\s+[A-Z][a-zA-Z\s]+|Isle?\s+(?:of\s+)?[A-Z][a-zA-Z\s]+|Island\s+(?:of\s+)?[A-Z][a-zA-Z\s]+|Port\s+[A-Z][a-zA-Z\s]+|Bay\s+[A-Z][a-zA-Z\s]+|Road\s+[A-Z][a-zA-Z\s]+)`)
)

func extractPlace(text string) string {
	// Try to find a named landmark.
	if m := landmarkRe.FindStringSubmatch(text); m != nil {
		return strings.TrimSpace(m[1])
	}
	return "At sea"
}
