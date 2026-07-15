package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/raphaelrong/on-that-day/internal/config"
	"github.com/raphaelrong/on-that-day/internal/db"
	"github.com/raphaelrong/on-that-day/internal/model"
	"github.com/raphaelrong/on-that-day/internal/parser"
	"github.com/raphaelrong/on-that-day/internal/repository"
)

func main() {
	cfg := config.MustLoad()
	file := flag.String("file", "resources/Captain Cook's Journal During His First Vo - James Cook.txt", "path to the voyage log text file")
	jsonPath := flag.String("json", "data/source/voyages/cook.json", "path to a parsed voyage JSON file")
	writeJSON := flag.Bool("write-json", false, "parse the text log and write the parsed voyage JSON file")
	flag.Parse()

	meta := parser.VoyageAuthor{
		Key:            "cook",
		Name:           "James Cook",
		Born:           "1728-11-07",
		Source:         "Captain Cook's Journal During His First Voyage Round the World",
		Note:           "British explorer and navigator",
		StartYear:      1768,
		StartMonth:     8,
		DefaultLatSign: -1, // Cook's first voyage was predominantly in the Southern Hemisphere.
		DefaultLngSign: -1, // The journal's preface states all longitudes are west of Greenwich.
	}

	var v *parser.Voyage
	var err error
	if *writeJSON {
		v, err = parser.ParseVoyageLog(*file, meta)
	} else {
		v, err = loadVoyage(*jsonPath)
		if err != nil {
			if !os.IsNotExist(err) {
				log.Fatalf("load voyage JSON: %v", err)
			}
			v, err = parser.ParseVoyageLog(*file, meta)
		}
	}
	if err != nil {
		log.Fatalf("parse voyage log: %v", err)
	}
	if *writeJSON {
		if err := writeVoyage(*jsonPath, v); err != nil {
			log.Fatalf("write voyage JSON: %v", err)
		}
		log.Printf("wrote parsed voyage JSON to %s", *jsonPath)
	}

	database := db.MustNew(cfg.DSN, false)
	if err := db.Ping(database); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	repo := repository.New(database)
	ctx := context.Background()
	if err := repo.Migrate(ctx); err != nil {
		log.Fatalf("migrate failed: %v", err)
	}

	log.Printf("upserting author %s...", v.Author.Key)
	if err := repo.UpsertAuthors(ctx, []model.Author{v.Author}); err != nil {
		log.Fatalf("upsert author failed: %v", err)
	}

	authors, err := repo.GetAuthors(ctx)
	if err != nil {
		log.Fatalf("reload authors failed: %v", err)
	}
	author := authors[v.Author.Key]

	if err := repo.DeleteEntriesByAuthor(ctx, author.ID); err != nil {
		log.Fatalf("delete existing voyage entries failed: %v", err)
	}

	entries := make([]model.Entry, len(v.Entries))
	for i, e := range v.Entries {
		entries[i] = e
		entries[i].AuthorID = author.ID
	}

	log.Printf("upserting %d voyage entries...", len(entries))
	if err := repo.UpsertEntries(ctx, entries); err != nil {
		log.Fatalf("upsert entries failed: %v", err)
	}

	count, err := repo.CountEntries(ctx)
	if err != nil {
		log.Fatalf("count entries failed: %v", err)
	}
	log.Printf("ingest complete. total entries in database: %d", count)
}

type voyageFile struct {
	Author  voyageAuthorFile  `json:"author"`
	Entries []model.EntryJSON `json:"entries"`
}

type voyageAuthorFile struct {
	Key    string           `json:"key"`
	Name   string           `json:"name"`
	Born   string           `json:"born"`
	Source string           `json:"source"`
	Note   string           `json:"note"`
	Type   model.AuthorType `json:"type"`
}

func loadVoyage(path string) (*parser.Voyage, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f voyageFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	v := &parser.Voyage{
		Author: model.Author{
			Key:    f.Author.Key,
			Name:   f.Author.Name,
			Born:   f.Author.Born,
			Source: f.Author.Source,
			Note:   f.Author.Note,
			Type:   f.Author.Type,
		},
		Entries: make([]model.Entry, len(f.Entries)),
	}
	if v.Author.Type == "" {
		v.Author.Type = model.AuthorTypeVoyage
	}
	for i, e := range f.Entries {
		v.Entries[i] = model.Entry{
			AuthorKey: e.AuthorKey,
			Year:      e.Year,
			Month:     e.Month,
			Day:       e.Day,
			Place:     e.Place,
			Lat:       float64(e.Lat),
			Lng:       float64(e.Lng),
			Text:      e.Text,
		}
	}
	return v, nil
}

func writeVoyage(path string, v *parser.Voyage) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f := voyageFile{
		Author: voyageAuthorFile{
			Key:    v.Author.Key,
			Name:   v.Author.Name,
			Born:   v.Author.Born,
			Source: v.Author.Source,
			Note:   v.Author.Note,
			Type:   v.Author.Type,
		},
		Entries: make([]model.EntryJSON, len(v.Entries)),
	}
	for i, e := range v.Entries {
		f.Entries[i] = model.EntryJSON{
			AuthorKey: v.Author.Key,
			Year:      e.Year,
			Month:     e.Month,
			Day:       e.Day,
			Place:     e.Place,
			Lat:       model.JSONFloat(e.Lat),
			Lng:       model.JSONFloat(e.Lng),
			Text:      e.Text,
		}
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return os.WriteFile(path, b, 0o644)
}
