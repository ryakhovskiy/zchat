package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadMaxUsers(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("ENCRYPTION_KEY", "test-key")
	t.Setenv("UPLOAD_DIR", t.TempDir())

	for _, tc := range []struct {
		name  string
		value string
		want  int
	}{
		{name: "default", value: "", want: 10},
		{name: "custom", value: "25", want: 25},
		{name: "one", value: "1", want: 1},
		{name: "zero", value: "0"},
		{name: "negative", value: "-1"},
		{name: "invalid", value: "invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MAX_USERS", tc.value)
			cfg, err := Load()
			if tc.want == 0 {
				require.EqualError(t, err, "MAX_USERS must be a positive integer")
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.want, cfg.MaxUsers)
		})
	}
}
