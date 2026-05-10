document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) window.lucide.createIcons();

    const togglePasswordEye = document.querySelector(".eye-icon");
    const passwordInputField = document.getElementById("password");
    const loginForm = document.getElementById("loginForm");
    const loginMessage = document.getElementById("loginMessage");
    const submitButton = loginForm.querySelector("button[type='submit']");

    if (window.ResQ?.getToken()) {
        window.location.href = "../WORKSPACE/workspace.html";
        return;
    }

    togglePasswordEye.addEventListener("click", () => {
        const isPasswordVisible = passwordInputField.getAttribute("type") === "text";
        passwordInputField.setAttribute("type", isPasswordVisible ? "password" : "text");
        togglePasswordEye.setAttribute("data-lucide", isPasswordVisible ? "eye" : "eye-off");
        if (window.lucide) window.lucide.createIcons();
    });

    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        loginMessage.classList.add("hidden");
        submitButton.disabled = true;
        submitButton.textContent = "Signing in...";

        const username = document.getElementById("username").value.trim();
        const password = passwordInputField.value;
        const remember = document.getElementById("stay-logged").checked;

        try {
            const response = await fetch(`${window.ResQ.API_BASE}/api/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: username, username, password })
            });
            const contentType = response.headers.get("content-type") || "";
            const payload = contentType.includes("application/json")
                ? await response.json()
                : { message: `Server returned ${response.status}. Please check the API deployment logs.` };

            if (!response.ok) {
                let message = payload.message || `Login failed with status ${response.status}`;

                if (message === "Server error") {
                    message = await getDeploymentErrorMessage(message);
                }

                throw new Error(message);
            }

            window.ResQ.saveSession(payload, remember);
            window.location.href = "../WORKSPACE/workspace.html";
        } catch (error) {
            loginMessage.textContent = error.message;
            loginMessage.classList.remove("hidden");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Sign In to Dashboard";
        }
    });

    async function getDeploymentErrorMessage(fallback) {
        try {
            const response = await fetch(`${window.ResQ.API_BASE}/api/deployment-check`);
            const payload = await response.json();
            const checks = payload.checks || {};

            if (checks.database && checks.database !== "connected") return checks.database;
            if (!checks.mongoUri) return "MONGO_URI is missing in Vercel environment variables.";
            if (!checks.jwtSecret) return "JWT_SECRET is missing in Vercel environment variables.";
            if (checks.supabaseReports && String(checks.supabaseReports).startsWith("Supabase")) return checks.supabaseReports;
        } catch {
            return fallback;
        }

        return fallback;
    }
});
