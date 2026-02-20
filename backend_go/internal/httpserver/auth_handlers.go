package httpserver

import (
	"encoding/json"
	"net/http"

	"backend_go/internal/service"
)

type registerRequest struct {
	Username string  `json:"username"`
	Email    *string `json:"email"`
	Password string  `json:"password"`
}

type loginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me"`
}

// tokenResponse mirrors the Python Token schema: access_token, token_type, user.
type tokenResponse struct {
	AccessToken string      `json:"access_token"`
	TokenType   string      `json:"token_type"`
	User        interface{} `json:"user"`
}

// @Summary      Register a new user
// @Description  Register a new user and return an access token
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        input body registerRequest true "Register input"
// @Success      201  {object}  tokenResponse
// @Failure      400  {object}  map[string]string
// @Router       /auth/register [post]
func handleRegister(authSvc *service.AuthService, userSvc *service.UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req registerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		user, err := authSvc.Register(r.Context(), service.RegisterInput{
			Username: req.Username,
			Email:    req.Email,
			Password: req.Password,
		})
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		// Auto-login after registration
		resp, err := authSvc.Login(r.Context(), service.LoginInput{
			Username: req.Username,
			Password: req.Password,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to login after registration"})
			return
		}
		// Ensure user in response is the created one
		writeJSON(w, http.StatusCreated, tokenResponse{
			AccessToken: resp.AccessToken,
			TokenType:   "bearer",
			User:        user,
		})
	}
}

// @Summary      Login
// @Description  Login with username and password
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        input body loginRequest true "Login input"
// @Success      200  {object}  tokenResponse
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Router       /auth/login [post]
func handleLogin(authSvc *service.AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		resp, err := authSvc.Login(r.Context(), service.LoginInput{
			Username:   req.Username,
			Password:   req.Password,
			RememberMe: req.RememberMe,
		})
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, tokenResponse{
			AccessToken: resp.AccessToken,
			TokenType:   "bearer",
			User:        resp.User,
		})
	}
}

// @Summary      Logout
// @Description  Logout user
// @Tags         auth
// @Security     BearerAuth
// @Success      204
// @Failure      401  {object}  map[string]string
// @Router       /auth/logout [post]
func handleLogout(authSvc *service.AuthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := CurrentUser(r)
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if err := authSvc.Logout(r.Context(), user.ID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// @Summary      Get Current User
// @Description  Get currently logged in user details
// @Tags         auth
// @Security     BearerAuth
// @Produce      json
// @Success      200  {object}  domain.User
// @Failure      401  {object}  map[string]string
// @Router       /auth/me [get]
func handleMe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := CurrentUser(r)
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, user)
	}
}
