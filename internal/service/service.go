package service

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/raphaelrong/on-that-day/internal/model"
	"github.com/raphaelrong/on-that-day/internal/repository"
)

// FallbackWindow is the maximum calendar-day distance for the nearest-entry fallback.
const FallbackWindow = 10

// Service provides the core backend logic.
type Service struct {
	repo *repository.Repository
}

// New creates a new Service.
func New(repo *repository.Repository) *Service {
	return &Service{repo: repo}
}

// ListAuthors returns the authors in the same shape as the original authors.json.
func (s *Service) ListAuthors(ctx context.Context) (map[string]model.AuthorJSON, error) {
	authors, err := s.repo.GetAuthors(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]model.AuthorJSON, len(authors))
	for key, a := range authors {
		out[key] = model.AuthorJSON{
			Name:   a.Name,
			Born:   a.Born,
			Source: a.Source,
			Note:   a.Note,
			Type:   a.Type,
		}
	}
	return out, nil
}

// GetVoyage returns the full chronological route for a voyage author.
func (s *Service) GetVoyage(ctx context.Context, authorKey string) (*model.VoyageResponse, error) {
	authors, err := s.repo.GetAuthors(ctx)
	if err != nil {
		return nil, err
	}
	a, ok := authors[authorKey]
	if !ok {
		return nil, fmt.Errorf("author not found: %s", authorKey)
	}
	if a.Type != model.AuthorTypeVoyage {
		return nil, fmt.Errorf("author %s is not a voyage", authorKey)
	}
	rows, err := s.repo.GetEntriesByAuthor(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	entries := make([]model.EntryJSON, len(rows))
	for i, e := range rows {
		entries[i] = model.EntryJSON{
			AuthorKey: authorKey,
			Year:      e.Year,
			Month:     e.Month,
			Day:       e.Day,
			Place:     e.Place,
			Lat:       model.JSONFloat(e.Lat),
			Lng:       model.JSONFloat(e.Lng),
			Text:      e.Text,
		}
	}
	return &model.VoyageResponse{Entries: entries}, nil
}

// GetDay returns the entries for a calendar day, mirroring the original days/MM-DD.json.
func (s *Service) GetDay(ctx context.Context, month, day int) (*model.DayResponse, error) {
	if month < 1 || month > 12 {
		return nil, fmt.Errorf("invalid month: %d", month)
	}
	if day < 1 || day > 31 {
		return nil, fmt.Errorf("invalid day: %d", day)
	}

	authors, err := s.repo.GetAuthors(ctx)
	if err != nil {
		return nil, err
	}

	rows, err := s.repo.GetAllEntriesWithAuthor(ctx)
	if err != nil {
		return nil, err
	}

	// Group by author and find the best delta for each author.
	type keyed struct {
		delta int
		entry model.EntryJSON
	}
	byAuthor := make(map[string][]keyed)
	for _, r := range rows {
		delta := dayDelta(r.Entry.Month, r.Entry.Day, month, day)
		byAuthor[r.AuthorKey] = append(byAuthor[r.AuthorKey], keyed{
			delta: delta,
			entry: model.EntryJSON{
				AuthorKey: r.AuthorKey,
				Year:      r.Entry.Year,
				Month:     r.Entry.Month,
				Day:       r.Entry.Day,
				Place:     r.Entry.Place,
				Lat:       model.JSONFloat(r.Entry.Lat),
				Lng:       model.JSONFloat(r.Entry.Lng),
				Text:      r.Entry.Text,
			},
		})
	}

	var picked []model.EntryJSON
	for _, items := range byAuthor {
		best := FallbackWindow + 1
		for _, it := range items {
			if it.delta < best {
				best = it.delta
			}
		}
		if best > FallbackWindow {
			continue
		}
		for _, it := range items {
			if it.delta != best {
				continue
			}
			entry := it.entry
			if best > 0 {
				entry.Delta = best
			}
			picked = append(picked, entry)
		}
	}

	// Sort by the original author order, then by year, matching build_data.py.
	sort.SliceStable(picked, func(i, j int) bool {
		ai := authors[picked[i].AuthorKey]
		aj := authors[picked[j].AuthorKey]
		if ai.SortOrder != aj.SortOrder {
			return ai.SortOrder < aj.SortOrder
		}
		return picked[i].Year < picked[j].Year
	})

	return &model.DayResponse{Entries: picked}, nil
}

// dayDelta returns the shortest distance in days between two month/day pairs,
// wrapping around the year end. It mirrors build_data.py's day_delta exactly.
func dayDelta(m1, d1, m2, d2 int) int {
	t1 := time.Date(2000, time.Month(m1), d1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2000, time.Month(m2), d2, 0, 0, 0, 0, time.UTC)
	diff := t1.Sub(t2)
	if diff < 0 {
		diff = -diff
	}
	days := int(diff.Hours() / 24)
	wrap := 366 - days
	if wrap < days {
		return wrap
	}
	return days
}
