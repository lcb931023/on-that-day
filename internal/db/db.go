package db

import (
	"fmt"
	"log"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// New opens a SQLite connection using the provided DSN.
// DSN is a file path; use ":memory:" for an in-memory database.
func New(dsn string, debug bool) (*gorm.DB, error) {
	level := logger.Silent
	if debug {
		level = logger.Info
	}
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(level),
	})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get underlying sql db: %w", err)
	}
	sqlDB.SetMaxOpenConns(1) // SQLite requires single writer for best concurrency
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(time.Hour)

	return db, nil
}

// Ping verifies the database connection is alive.
func Ping(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Ping()
}

// MustNew is like New but panics on error.
func MustNew(dsn string, debug bool) *gorm.DB {
	db, err := New(dsn, debug)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	return db
}
