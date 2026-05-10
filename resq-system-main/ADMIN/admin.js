(function () {
    function getApiBase() {
        const explicit = window.ResQ_API_BASE || window.RESQ_API_BASE;
        if (explicit) return explicit.replace(/\/+$/, "");

        const meta = document.querySelector("meta[name='resq-api-base']");
        if (meta?.content) return meta.content.replace(/\/+$/, "");

        if (window.location.protocol === "file:") {
            throw new Error("Set window.ResQ_API_BASE or meta[name='resq-api-base'] when opening files directly.");
        }

        return window.location.origin;
    }

    const API_BASE = getApiBase();
    const LOGIN_PATH = "/LOGIN/login.html";

    function getToken() {
        return localStorage.getItem("resqToken") || sessionStorage.getItem("resqToken");
    }

    function getUser() {
        const raw = localStorage.getItem("resqUser") || sessionStorage.getItem("resqUser");
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function saveSession(payload, remember) {
        const storage = remember ? localStorage : sessionStorage;
        clearSession();
        storage.setItem("resqToken", payload.token);
        storage.setItem("resqUser", JSON.stringify(payload.user));
    }

    function clearSession() {
        localStorage.removeItem("resqToken");
        localStorage.removeItem("resqUser");
        sessionStorage.removeItem("resqToken");
        sessionStorage.removeItem("resqUser");
    }

    function requireAuth() {
        if (!getToken()) {
            window.location.href = LOGIN_PATH;
            return false;
        }
        return true;
    }

    async function apiFetch(path, options = {}) {
        const token = getToken();
        const headers = {
            ...(options.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
        if (response.status === 401 || response.status === 403) {
            clearSession();
            window.location.href = LOGIN_PATH;
            throw new Error("Session expired. Please log in again.");
        }

        return response;
    }

    async function apiJson(path, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers || {})
        };
        const response = await apiFetch(path, { ...options, headers });
        const payload = (response.headers.get("content-type") || "").includes("application/json")
            ? await response.json()
            : null;

        if (!response.ok) throw new Error(payload?.message || `Request failed with status ${response.status}`);
        return payload;
    }

    async function apiForm(path, formData, options = {}) {
        const response = await apiFetch(path, {
            ...options,
            method: options.method || "POST",
            body: formData
        });
        const payload = (response.headers.get("content-type") || "").includes("application/json")
            ? await response.json()
            : null;

        if (!response.ok) throw new Error(payload?.message || `Request failed with status ${response.status}`);
        return payload;
    }

    function logout() {
        clearSession();
        window.location.href = LOGIN_PATH;
    }

    function bindLogout() {
        document.querySelectorAll("[data-action='logout']").forEach(button => {
            button.addEventListener("click", logout);
        });
    }

    window.ResQ = {
        API_BASE,
        getToken,
        getUser,
        saveSession,
        clearSession,
        requireAuth,
        apiFetch,
        apiJson,
        apiForm,
        logout,
        bindLogout
    };
})();
