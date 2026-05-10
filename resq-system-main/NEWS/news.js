document.addEventListener("DOMContentLoaded", () => {

    if (window.ResQ && window.ResQ.requireAuth) {
        const authenticated = window.ResQ.requireAuth();
        if (!authenticated) {
            console.warn("Auth check failed.");
        }
    }
    if (window.ResQ && window.ResQ.bindLogout) {
    window.ResQ.bindLogout();
}

    const state = {
        news: [],
        search: "",
        category: "all",
        editingId: ""
    };

    const elements = {
        form: document.getElementById("newsForm"),
        formMode: document.getElementById("formMode"),
        formTitle: document.getElementById("formTitle"),
        cancelEdit: document.querySelector("[data-action='cancel-edit']"),
        imageInput: document.getElementById("imageInput"),
        imagePreview: document.getElementById("imagePreview"),
        grid: document.getElementById("newsGrid"),
        latestList: document.getElementById("latestList"),
        resultCount: document.getElementById("resultCount"),
        search: document.getElementById("newsSearch"),
        categoryFilter: document.getElementById("categoryFilter"),
        toast: document.getElementById("toast"),
        totalNews: document.getElementById("totalNews"),
        activeNews: document.getElementById("activeNews"),
        archivedNews: document.getElementById("archivedNews"),
        totalViews: document.getElementById("totalViews")
    };

    function initIcons() {
        if (window.lucide) window.lucide.createIcons();
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatDate(value) {
        if (!value) return "Not scheduled";
        return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    }

    function toDatetimeLocal(value) {
        const date = value ? new Date(value) : new Date();
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add("show");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
    }

    function imageUrl(url = "") {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        return `${window.ResQ.API_BASE}${url}`;
    }

    function priorityBadge(priority) {
        return `<span class="badge priority-${escapeHtml(String(priority).toLowerCase())}">${escapeHtml(priority)}</span>`;
    }

    function filteredNews() {
        const term = state.search.trim().toLowerCase();
        return state.news.filter(item => {
            const categoryMatch = state.category === "all" || item.category === state.category;
            const searchable = [item.title, item.message, item.category, item.priority, item.targetAudience].join(" ").toLowerCase();
            return categoryMatch && (!term || searchable.includes(term));
        });
    }

    function renderPreview(file) {
        if (!file) {
            elements.imagePreview.innerHTML = `<i data-lucide="image" size="28"></i><span>No image selected</span>`;
            initIcons();
            return;
        }
        const url = URL.createObjectURL(file);
        elements.imagePreview.innerHTML = `<img src="${url}" alt="Selected announcement image preview">`;
    }

    function renderSummary(analytics = {}) {
        elements.totalNews.textContent = analytics.total || 0;
        elements.activeNews.textContent = analytics.active || 0;
        elements.archivedNews.textContent = analytics.archived || 0;
        elements.totalViews.textContent = analytics.views || 0;
    }

    function renderLatest() {
        const latest = state.news.slice(0, 5);
        elements.latestList.innerHTML = latest.length ? latest.map(item => `
            <div class="latest-item">
                <i data-lucide="${item.priority === "Emergency" ? "siren" : "newspaper"}" size="15"></i>
                <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.category)} - ${formatDate(item.publishedAt)}</span>
                </div>
            </div>
        `).join("") : `<p class="muted-copy">No active announcements yet.</p>`;
        initIcons();
    }

    function renderCards() {
        const items = filteredNews();
        elements.resultCount.textContent = `${items.length} found`;
        if (!items.length) {
            elements.grid.innerHTML = `<div class="empty-state"><i data-lucide="search-x" size="30"></i><h2>No announcements found</h2><p>Adjust the search or category filter to view more posts.</p></div>`;
            initIcons();
            return;
        }

        elements.grid.innerHTML = items.map(item => `
            <article class="news-card">
                <div class="news-image">
                    ${item.imageUrl ? `<img src="${escapeHtml(imageUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}">` : `<i data-lucide="newspaper" size="32"></i>`}
                </div>
                <div class="news-content">
                    <div class="news-title-row">
                        <h3>${escapeHtml(item.title)}</h3>
                        ${priorityBadge(item.priority)}
                    </div>
                    <div class="meta-row">
                        <span class="badge category-badge">${escapeHtml(item.category)}</span>
                        ${item.pinned ? `<span class="badge pinned-badge"><i data-lucide="pin" size="12"></i>Pinned</span>` : ""}
                    </div>
                    <p>${escapeHtml(item.message).slice(0, 180)}${item.message.length > 180 ? "..." : ""}</p>
                    <div class="meta-row">
                        <span>${formatDate(item.publishedAt)}</span>
                        <span>${Number(item.views || 0)} views</span>
                        <span>${escapeHtml(item.targetAudience || "All residents")}</span>
                    </div>
                    <div class="card-actions">
                        <button class="mini-btn" type="button" data-action="edit" data-id="${item.id}">Edit</button>
                        <button class="mini-btn warning" type="button" data-action="archive" data-id="${item.id}">Archive</button>
                        <button class="mini-btn danger" type="button" data-action="delete" data-id="${item.id}">Delete</button>
                    </div>
                </div>
            </article>
        `).join("");
        initIcons();
    }

    function resetForm() {
        state.editingId = "";
        elements.form.reset();
        elements.form.elements.publishedAt.value = toDatetimeLocal();
        elements.form.elements.targetAudience.value = "All residents";
        elements.formMode.textContent = "Create Announcement";
        elements.formTitle.textContent = "Publish News";
        elements.cancelEdit.classList.add("hidden");
        renderPreview(null);
    }

    function editNews(id) {
        const item = state.news.find(news => news.id === id);
        if (!item) return;
        state.editingId = id;
        elements.form.elements.id.value = id;
        elements.form.elements.title.value = item.title || "";
        elements.form.elements.category.value = item.category || "General News";
        elements.form.elements.priority.value = item.priority || "Low";
        elements.form.elements.publishedAt.value = toDatetimeLocal(item.publishedAt);
        elements.form.elements.targetAudience.value = item.targetAudience || "All residents";
        elements.form.elements.pinned.checked = Boolean(item.pinned);
        elements.form.elements.message.value = item.message || "";
        elements.formMode.textContent = "Edit Announcement";
        elements.formTitle.textContent = item.title || "Update News";
        elements.cancelEdit.classList.remove("hidden");
        elements.imagePreview.innerHTML = item.imageUrl
            ? `<img src="${escapeHtml(imageUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}">`
            : `<i data-lucide="image" size="28"></i><span>No image selected</span>`;
        window.scrollTo({ top: 0, behavior: "smooth" });
        initIcons();
    }

    async function loadNews() {
        elements.grid.innerHTML = `<div class="empty-state"><i data-lucide="loader-circle" size="30"></i><h2>Loading announcements</h2><p>Connecting to the ResQ backend.</p></div>`;
        initIcons();
        try {
            const [news, analytics] = await Promise.all([
                window.ResQ.apiJson("/api/news"),
                window.ResQ.apiJson("/api/news/analytics")
            ]);
            state.news = news;
            renderSummary(analytics);
            renderCards();
            renderLatest();
        } catch (error) {
            elements.grid.innerHTML = `<div class="empty-state"><i data-lucide="wifi-off" size="30"></i><h2>News unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
            showToast(error.message);
            initIcons();
        }
    }

    async function saveNews(event) {
        event.preventDefault();
        const formData = new FormData(elements.form);
        formData.set("pinned", elements.form.elements.pinned.checked ? "true" : "false");
        if (!elements.imageInput.files.length) formData.delete("image");

        try {
            const id = state.editingId;
            const saved = await window.ResQ.apiForm(id ? `/api/news/${id}` : "/api/news", formData, {
                method: id ? "PUT" : "POST"
            });
            showToast(`${saved.title} saved.`);
            resetForm();
            await loadNews();
        } catch (error) {
            showToast(error.message);
        }
    }

    async function archiveNews(id) {
        if (!window.confirm("Archive this announcement?")) return;
        try {
            await window.ResQ.apiJson(`/api/news/${id}/archive`, { method: "POST", body: JSON.stringify({}) });
            showToast("Announcement archived.");
            await loadNews();
        } catch (error) {
            showToast(error.message);
        }
    }

    async function deleteNews(id) {
        if (!window.confirm("Delete this announcement permanently?")) return;
        try {
            await window.ResQ.apiJson(`/api/news/${id}`, { method: "DELETE", body: JSON.stringify({}) });
            showToast("Announcement deleted.");
            await loadNews();
        } catch (error) {
            showToast(error.message);
        }
    }

    elements.form.addEventListener("submit", saveNews);
    elements.form.addEventListener("reset", () => setTimeout(resetForm, 0));
    elements.imageInput.addEventListener("change", event => renderPreview(event.target.files[0]));
    elements.cancelEdit.addEventListener("click", resetForm);
    elements.search.addEventListener("input", event => {
        state.search = event.target.value;
        renderCards();
    });
    elements.categoryFilter.addEventListener("change", event => {
        state.category = event.target.value;
        renderCards();
    });
    elements.grid.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        if (button.dataset.action === "edit") editNews(button.dataset.id);
        if (button.dataset.action === "archive") archiveNews(button.dataset.id);
        if (button.dataset.action === "delete") deleteNews(button.dataset.id);
    });
    document.querySelectorAll("[data-action='refresh']").forEach(button => button.addEventListener("click", loadNews));
    document.querySelector("[data-action='new']").addEventListener("click", resetForm);

    resetForm();
    loadNews();
});
