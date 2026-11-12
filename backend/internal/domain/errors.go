package domain

import "errors"

// Sentinel errors for the application.
var (
	ErrNotFound           = errors.New("resource not found")
	ErrUnauthorized       = errors.New("unauthorized access")
	ErrForbidden          = errors.New("forbidden")
	ErrConflict           = errors.New("resource already exists")
	ErrUserLimitReached   = errors.New("The maximum number of users has been reached. New users cannot be registered.")
	ErrInternal           = errors.New("internal server error")
	ErrInvalidInput       = errors.New("invalid input")
	ErrDatabaseConnection = errors.New("database connection error")
)
