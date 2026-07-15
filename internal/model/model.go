package model

import (
	"strconv"
	"strings"
	"time"
)

// JSONFloat is a float64 that serializes with a decimal point, matching Python's json.dumps.
type JSONFloat float64

// MarshalJSON implements json.Marshaler.
func (f JSONFloat) MarshalJSON() ([]byte, error) {
	s := strconv.FormatFloat(float64(f), 'f', -1, 64)
	if !strings.ContainsAny(s, ".eE") {
		s += ".0"
	}
	return []byte(s), nil
}

// AuthorType distinguishes diary authors from voyage authors.
type AuthorType string

const (
	AuthorTypeDiary  AuthorType = "diary"
	AuthorTypeVoyage AuthorType = "voyage"
)

// Author maps to the authors table and mirrors the original authors.json values.
type Author struct {
	ID        uint64     `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	Key       string     `gorm:"column:key;type:varchar(32);uniqueIndex;not null" json:"-"`
	Name      string     `gorm:"column:name;type:varchar(255);not null" json:"name"`
	Born      string     `gorm:"column:born;type:varchar(10);not null" json:"born"`
	Source    string     `gorm:"column:source;type:varchar(500);not null" json:"source"`
	Note      string     `gorm:"column:note;type:text" json:"note"`
	Type      AuthorType `gorm:"column:type;type:varchar(16);not null;default:'diary'" json:"type"`
	SortOrder int        `gorm:"column:sort_order;not null;default:0" json:"-"`
	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"-"`
	UpdatedAt time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"-"`
}

// TableName returns the table name for Author.
func (Author) TableName() string {
	return "authors"
}

// Entry maps to the entries table and mirrors a single diary entry.
type Entry struct {
	ID        uint64    `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	AuthorID  uint64    `gorm:"column:author_id;not null;index;uniqueIndex:idx_entries_author_date" json:"-"`
	AuthorKey string    `gorm:"-" json:"a"`
	Year      int       `gorm:"column:year;not null;uniqueIndex:idx_entries_author_date" json:"y"`
	Month     int       `gorm:"column:month;not null;uniqueIndex:idx_entries_author_date" json:"m"`
	Day       int       `gorm:"column:day;not null;uniqueIndex:idx_entries_author_date" json:"d"`
	Place     string    `gorm:"column:place;type:varchar(500);not null" json:"place"`
	Lat       float64   `gorm:"column:lat;not null" json:"lat"`
	Lng       float64   `gorm:"column:lng;not null" json:"lng"`
	Text      string    `gorm:"column:text;type:longtext;not null" json:"text"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"-"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"-"`
}

// TableName returns the table name for Entry.
func (Entry) TableName() string {
	return "entries"
}

// AuthorJSON is the public shape of an author in authors.json.
type AuthorJSON struct {
	Name   string     `json:"name"`
	Born   string     `json:"born"`
	Source string     `json:"source"`
	Note   string     `json:"note"`
	Type   AuthorType `json:"type,omitempty"`
}

// VoyageResponse returns the full chronological route of a voyage author.
type VoyageResponse struct {
	Entries []EntryJSON `json:"entries"`
}

// EntryJSON is the public shape of an entry in days/MM-DD.json.
type EntryJSON struct {
	AuthorKey string  `json:"a"`
	Year      int     `json:"y"`
	Month     int     `json:"m"`
	Day       int     `json:"d"`
	Place     string    `json:"place"`
	Lat       JSONFloat `json:"lat"`
	Lng       JSONFloat `json:"lng"`
	Text      string    `json:"text"`
	Delta     int     `json:"delta,omitempty"`
}

// DayResponse is the top-level shape of a day shard response.
type DayResponse struct {
	Entries []EntryJSON `json:"entries"`
}
