package repository

import (
	"context"
	"fmt"

	"github.com/raphaelrong/on-that-day/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository provides data access for authors and entries.
type Repository struct {
	db *gorm.DB
}

// New creates a new Repository.
func New(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Migrate ensures the database schema is up to date.
func (r *Repository) Migrate(ctx context.Context) error {
	return r.db.WithContext(ctx).AutoMigrate(&model.Author{}, &model.Entry{})
}

// UpsertAuthors inserts or updates authors by their unique key.
func (r *Repository) UpsertAuthors(ctx context.Context, authors []model.Author) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			UpdateAll: true,
		}).
		CreateInBatches(&authors, 50).Error
}

// UpsertEntries inserts or updates entries by (author_id, year, month, day).
func (r *Repository) UpsertEntries(ctx context.Context, entries []model.Entry) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "author_id"},
				{Name: "year"},
				{Name: "month"},
				{Name: "day"},
			},
			UpdateAll: true,
		}).
		CreateInBatches(&entries, 100).Error
}

// DeleteEntriesByAuthor removes all entries for a single author.
func (r *Repository) DeleteEntriesByAuthor(ctx context.Context, authorID uint64) error {
	return r.db.WithContext(ctx).
		Where("author_id = ?", authorID).
		Delete(&model.Entry{}).Error
}

// GetAuthors returns all authors keyed by their short key.
func (r *Repository) GetAuthors(ctx context.Context) (map[string]model.Author, error) {
	var rows []model.Author
	if err := r.db.WithContext(ctx).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query authors: %w", err)
	}
	out := make(map[string]model.Author, len(rows))
	for _, a := range rows {
		out[a.Key] = a
	}
	return out, nil
}

// GetAuthorsOrdered returns all authors sorted by their original order.
func (r *Repository) GetAuthorsOrdered(ctx context.Context) ([]model.Author, error) {
	var rows []model.Author
	if err := r.db.WithContext(ctx).Order("sort_order ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query authors ordered: %w", err)
	}
	return rows, nil
}

// EntryWithAuthor is a joined view of an entry plus its author key.
type EntryWithAuthor struct {
	model.Entry
	AuthorKey string `gorm:"column:author_key"`
}

// GetAllEntriesWithAuthor returns every entry joined with its author key.
func (r *Repository) GetAllEntriesWithAuthor(ctx context.Context) ([]EntryWithAuthor, error) {
	var rows []EntryWithAuthor
	err := r.db.WithContext(ctx).
		Model(&model.Entry{}).
		Select("entries.*, authors.key AS author_key").
		Joins("INNER JOIN authors ON authors.id = entries.author_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("query entries: %w", err)
	}
	return rows, nil
}

// GetEntriesByAuthor returns all entries for a single author, sorted chronologically.
func (r *Repository) GetEntriesByAuthor(ctx context.Context, authorID uint64) ([]model.Entry, error) {
	var rows []model.Entry
	if err := r.db.WithContext(ctx).
		Where("author_id = ?", authorID).
		Order("year ASC, month ASC, day ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query entries by author: %w", err)
	}
	return rows, nil
}

// CountEntries returns the total number of entries in the database.
func (r *Repository) CountEntries(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Entry{}).Count(&count).Error
	return count, err
}
