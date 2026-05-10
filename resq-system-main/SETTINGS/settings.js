document.addEventListener("DOMContentLoaded", () => {
    if (!window.ResQ.requireAuth()) return;
    window.ResQ.bindLogout();
    const state = {
        barangays: [],
        settings: {
            moderation: { keywords: [], threshold: 5 },
            reasons: { approval: [], rejection: [] }
        }
    };

    const elements = {
        barangayGrid: document.getElementById("barangayGrid"),
        keywordTags: document.getElementById("keywordTags"),
        keywordInput: document.getElementById("keywordInput"),
        thresholdSlider: document.getElementById("thresholdSlider"),
        thresholdValue: document.getElementById("thresholdValue"),
        approvalReasons: document.getElementById("approvalReasons"),
        rejectionReasons: document.getElementById("rejectionReasons"),
        search: document.getElementById("settingsSearch"),
        toast: document.getElementById("toast")
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

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add("show");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
    }

    function renderBarangays() {
        elements.barangayGrid.innerHTML = state.barangays.map(barangay => `
            <article class="barangay-item">
                <div class="barangay-icon ${barangay.status === "offline" ? "offline" : ""}">
                    <i data-lucide="building-2" size="18"></i>
                </div>
                <div class="barangay-details">
                    <strong>${escapeHtml(barangay.name)}</strong>
                    <span>${escapeHtml(barangay.district)} · ${barangay.residents.toLocaleString()} residents</span>
                </div>
                <span class="status-pill status-${escapeHtml(barangay.status)}">${escapeHtml(barangay.status)}</span>
                <button class="icon-btn" type="button" data-toggle-barangay="${barangay.id}" title="Toggle status">
                    <i data-lucide="power" size="16"></i>
                </button>
            </article>
        `).join("");

        initIcons();
    }

    function renderKeywords() {
        const keywords = state.settings.moderation.keywords;

        elements.keywordTags.innerHTML = keywords.length
            ? keywords.map(keyword => `
                <span class="tag">
                    ${escapeHtml(keyword)}
                    <button type="button" data-remove-keyword="${escapeHtml(keyword)}" title="Remove keyword">
                        <i data-lucide="x" size="12"></i>
                    </button>
                </span>
            `).join("")
            : `<span class="helper-text">No keywords added.</span>`;

        elements.thresholdSlider.value = state.settings.moderation.threshold;
        elements.thresholdValue.textContent = `${state.settings.moderation.threshold} Reports`;
        initIcons();
    }

    function renderReasons() {
        elements.approvalReasons.innerHTML = renderReasonList("approval");
        elements.rejectionReasons.innerHTML = renderReasonList("rejection");
        initIcons();
    }

    function renderReasonList(type) {
        const reasons = state.settings.reasons[type];
        if (!reasons.length) return `<li>No reasons added.</li>`;

        return reasons.map((reason, index) => `
            <li>
                <span>${escapeHtml(reason)}</span>
                <button class="icon-btn" type="button" data-remove-reason="${type}" data-index="${index}" title="Remove reason">
                    <i data-lucide="trash-2" size="14"></i>
                </button>
            </li>
        `).join("");
    }

    function renderAll() {
        renderBarangays();
        renderKeywords();
        renderReasons();
    }

    async function saveModeration(nextModeration) {
        const moderation = await window.ResQ.apiJson("/api/settings/moderation", {
            method: "PATCH",
            body: JSON.stringify(nextModeration)
        });

        state.settings.moderation = moderation;
        renderKeywords();
    }

    async function saveReasons() {
        const reasons = await window.ResQ.apiJson("/api/settings/reasons", {
            method: "PATCH",
            body: JSON.stringify(state.settings.reasons)
        });

        state.settings.reasons = reasons;
        renderReasons();
    }

    async function loadSettings() {
        try {
            const payload = await window.ResQ.apiJson("/api/settings");
            state.barangays = payload.barangays;
            state.settings = payload.settings;
            renderAll();
        } catch (error) {
            showToast(error.message);
        }
    }

    async function addBarangay() {
        const name = window.prompt("Barangay name");
        if (!name) return;

        const district = window.prompt("District or area", "New operating area") || "New operating area";

        try {
            const barangay = await window.ResQ.apiJson("/api/settings/barangays", {
                method: "POST",
                body: JSON.stringify({ name, district })
            });
            state.barangays.push(barangay);
            renderBarangays();
            showToast(`${barangay.name} added.`);
        } catch (error) {
            showToast(error.message);
        }
    }

    async function toggleBarangay(id) {
        try {
            const updated = await window.ResQ.apiJson(`/api/settings/barangays/${id}`, { method: "PATCH" });
            state.barangays = state.barangays.map(barangay => barangay.id === updated.id ? updated : barangay);
            renderBarangays();
            showToast(`${updated.name} is now ${updated.status}.`);
        } catch (error) {
            showToast(error.message);
        }
    }

    function addKeyword() {
        const keyword = elements.keywordInput.value.trim();
        if (!keyword) return;

        const keywords = Array.from(new Set([...state.settings.moderation.keywords, keyword]));
        elements.keywordInput.value = "";
        saveModeration({ keywords }).then(() => showToast("Keyword list updated.")).catch(error => showToast(error.message));
    }

    function removeKeyword(keyword) {
        const keywords = state.settings.moderation.keywords.filter(item => item !== keyword);
        saveModeration({ keywords }).then(() => showToast("Keyword removed.")).catch(error => showToast(error.message));
    }

    function addReason() {
        const type = window.prompt("Reason type: approval or rejection", "approval");
        if (!["approval", "rejection"].includes(type)) {
            showToast("Use approval or rejection as the reason type.");
            return;
        }

        const reason = window.prompt("Reason text");
        if (!reason) return;

        state.settings.reasons[type].push(reason);
        saveReasons().then(() => showToast("Reason added.")).catch(error => showToast(error.message));
    }

    function removeReason(type, index) {
        state.settings.reasons[type].splice(index, 1);
        saveReasons().then(() => showToast("Reason removed.")).catch(error => showToast(error.message));
    }

    elements.barangayGrid.addEventListener("click", event => {
        const button = event.target.closest("[data-toggle-barangay]");
        if (button) toggleBarangay(Number(button.dataset.toggleBarangay));
    });

    elements.keywordTags.addEventListener("click", event => {
        const button = event.target.closest("[data-remove-keyword]");
        if (button) removeKeyword(button.dataset.removeKeyword);
    });

    document.querySelector(".reasons-grid").addEventListener("click", event => {
        const button = event.target.closest("[data-remove-reason]");
        if (button) removeReason(button.dataset.removeReason, Number(button.dataset.index));
    });

    elements.thresholdSlider.addEventListener("input", event => {
        elements.thresholdValue.textContent = `${event.target.value} Reports`;
    });

    elements.thresholdSlider.addEventListener("change", event => {
        saveModeration({ threshold: Number(event.target.value) })
            .then(() => showToast("Threshold saved."))
            .catch(error => showToast(error.message));
    });

    elements.keywordInput.addEventListener("keydown", event => {
        if (event.key === "Enter") addKeyword();
    });

    elements.search.addEventListener("input", event => {
        const term = event.target.value.trim().toLowerCase();
        document.querySelectorAll(".settings-card").forEach(card => {
            card.classList.toggle("hidden", term && !card.textContent.toLowerCase().includes(term));
        });
    });

    document.querySelector("[data-action='add-keyword']").addEventListener("click", addKeyword);
    document.querySelector("[data-action='add-barangay']").addEventListener("click", addBarangay);
    document.querySelector("[data-action='add-reason']").addEventListener("click", addReason);

    document.querySelectorAll("[data-action='refresh']").forEach(button => {
        button.addEventListener("click", loadSettings);
    });

    document.querySelector("[data-action='workspace']").addEventListener("click", () => {
        window.location.href = "../WORKSPACE/workspace.html";
    });

    initIcons();
    loadSettings();
});
