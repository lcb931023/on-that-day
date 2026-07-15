package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/raphaelrong/on-that-day/internal/config"
	"github.com/raphaelrong/on-that-day/internal/db"
	"github.com/raphaelrong/on-that-day/internal/model"
	"github.com/raphaelrong/on-that-day/internal/repository"
)

func main() {
	cfg := config.MustLoad()
	dataDir := flag.String("data-dir", cfg.DataDir, "path to the original site/data directory")
	flag.Parse()

	if *dataDir == "" {
		log.Fatal("--data-dir is required")
	}

	database := db.MustNew(cfg.DSN, false)
	if err := db.Ping(database); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	repo := repository.New(database)
	ctx := context.Background()

	log.Println("migrating schema...")
	if err := repo.Migrate(ctx); err != nil {
		log.Fatalf("migrate failed: %v", err)
	}

	authorsPath := filepath.Join(*dataDir, "authors.json")
	authorPairs, err := loadAuthorsOrdered(authorsPath)
	if err != nil {
		log.Fatalf("load authors: %v", err)
	}

	authorModels := make([]model.Author, 0, len(authorPairs))
	for i, p := range authorPairs {
		authorModels = append(authorModels, model.Author{
			Key:       p.Key,
			Name:      p.Value.Name,
			Born:      p.Value.Born,
			Source:    p.Value.Source,
			Note:      p.Value.Note,
			SortOrder: i,
		})
	}

	log.Printf("upserting %d authors...", len(authorModels))
	if err := repo.UpsertAuthors(ctx, authorModels); err != nil {
		log.Fatalf("upsert authors failed: %v", err)
	}

	// Reload authors to get their database IDs.
	authorRows, err := repo.GetAuthors(ctx)
	if err != nil {
		log.Fatalf("reload authors failed: %v", err)
	}

	daysDir := filepath.Join(*dataDir, "days")
	entries, err := loadEntries(daysDir, authorRows)
	if err != nil {
		log.Fatalf("load entries: %v", err)
	}

	log.Printf("upserting %d entries...", len(entries))
	if err := repo.UpsertEntries(ctx, entries); err != nil {
		log.Fatalf("upsert entries failed: %v", err)
	}

	count, err := repo.CountEntries(ctx)
	if err != nil {
		log.Fatalf("count entries failed: %v", err)
	}
	log.Printf("sync complete. total entries in database: %d", count)
}

type authorPair struct {
	Key   string
	Value model.AuthorJSON
}

// loadAuthorsOrdered decodes authors.json while preserving the original key order.
func loadAuthorsOrdered(path string) ([]authorPair, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("decode authors: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return nil, fmt.Errorf("expected top-level object in %s", path)
	}

	var pairs []authorPair
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("decode authors key: %w", err)
		}
		key, ok := keyTok.(string)
		if !ok {
			return nil, fmt.Errorf("expected string key in %s", path)
		}
		var a model.AuthorJSON
		if err := dec.Decode(&a); err != nil {
			return nil, fmt.Errorf("decode author %s: %w", key, err)
		}
		pairs = append(pairs, authorPair{Key: key, Value: a})
	}

	// consume closing '}'
	if _, err := dec.Token(); err != nil {
		return nil, fmt.Errorf("decode authors close: %w", err)
	}
	return pairs, nil
}

func loadEntries(daysDir string, authors map[string]model.Author) ([]model.Entry, error) {
	files, err := filepath.Glob(filepath.Join(daysDir, "*.json"))
	if err != nil {
		return nil, fmt.Errorf("glob days: %w", err)
	}
	sort.Strings(files)

	seen := make(map[string]struct{})
	var entries []model.Entry

	for _, path := range files {
		f, err := os.Open(path)
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", path, err)
		}
		var shard model.DayResponse
		if err := json.NewDecoder(f).Decode(&shard); err != nil {
			f.Close()
			return nil, fmt.Errorf("decode %s: %w", path, err)
		}
		f.Close()

		for _, e := range shard.Entries {
			author, ok := authors[e.AuthorKey]
			if !ok {
				return nil, fmt.Errorf("unknown author %q in %s", e.AuthorKey, path)
			}
			key := fmt.Sprintf("%s|%d|%d|%d", e.AuthorKey, e.Year, e.Month, e.Day)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			entries = append(entries, model.Entry{
				AuthorID: author.ID,
				Year:     e.Year,
				Month:    e.Month,
				Day:      e.Day,
				Place:    strings.TrimSpace(e.Place),
				Lat:      float64(e.Lat),
				Lng:      float64(e.Lng),
				Text:     strings.TrimSpace(e.Text),
			})
		}
	}
	return entries, nil
}
