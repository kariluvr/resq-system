document.addEventListener("DOMContentLoaded", () => {
    if (!window.ResQ.requireAuth()) return;
    window.ResQ.bindLogout();

    const MAMBURAO_CENTER = { lat: 13.2233, lng: 120.5960 };
    const statusLabels = {
        received: "Received",
        verified: "Verified",
        resolved: "Resolved",
        false_report: "False Report"
    };
    const statusIcons = {
        received: "archive",
        verified: "check-circle",
        resolved: "shield-check",
        false_report: "alert-circle"
    };
    const statusFlow = ["received", "verified", "resolved", "false_report"];

    const state = {
        reports: [],
        selectedReportId: null,
        typeFilter: "all",
        search: "",
        map: null,
        mapMarker: null,
        mapReady: false
    };

    const elements = {
        list: document.querySelector(".report-items"),
        detail: document.querySelector(".report-detail"),
        resultCount: document.getElementById("resultCount"),
        typeFilter: document.getElementById("typeFilter"),
        search: document.getElementById("reportSearch"),
        toast: document.getElementById("toast"),
        modal: document.getElementById("reportModal"),
        createForm: document.getElementById("createReportForm"),
        summaryTotal: document.getElementById("summaryTotal"),
        summaryReceived: document.getElementById("summaryReceived"),
        summaryCritical: document.getElementById("summaryCritical")
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
        if (!value) return "Not available";
        return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    }

    function labelStatus(status) {
        return statusLabels[status] || String(status || "received").replaceAll("_", " ");
    }

    function getCoordinates(report) {
        if (report?.coordinates && typeof report.coordinates === "object") {
            return { lat: Number(report.coordinates.lat), lng: Number(report.coordinates.lng) };
        }
        if (typeof report?.coordinates === "string") {
            const [lat, lng] = report.coordinates.split(",").map(part => Number(part.trim()));
            return { lat, lng };
        }
        return MAMBURAO_CENTER;
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add("show");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
    }

    function statusBadge(status) {
        const icon = statusIcons[status] || "bookmark";
        return `<span class="status-badge status-${escapeHtml(status)}"><i data-lucide="${icon}" size="14"></i><span>${escapeHtml(labelStatus(status))}</span></span>`;
    }

    function priorityBadge(priority) {
        return `<span class="priority-badge priority-${escapeHtml(priority)}">${escapeHtml(priority)}</span>`;
    }

    function applyFilters() {
        const term = state.search.trim().toLowerCase();
        return state.reports.filter(report => {
            const matchesType = state.typeFilter === "all" || report.type === state.typeFilter;
            const searchable = [
                report.id,
                report.type,
                report.title,
                report.status,
                report.priority,
                report.reporter,
                report.mobile,
                report.location,
                report.description,
                report.assignedTo,
                report.dispatch?.responder
            ].join(" ").toLowerCase();
            return matchesType && (!term || searchable.includes(term));
        });
    }

    function renderSummary(summary) {
        elements.summaryTotal.textContent = summary.total || 0;
        elements.summaryReceived.textContent = summary.received || 0;
        elements.summaryCritical.textContent = summary.critical || 0;
    }

    function renderList() {
        const reports = applyFilters();
        elements.resultCount.textContent = `${reports.length} found`;

        if (!reports.length) {
            elements.list.innerHTML = `<div class="empty-state"><i data-lucide="search-x" size="28"></i><h2>No reports found</h2><p>Adjust the search or filters to view more incidents.</p></div>`;
            initIcons();
            return;
        }

        elements.list.innerHTML = reports.map(report => `
            <button class="report-item ${report.id === state.selectedReportId ? "active" : ""}" type="button" data-id="${report.id}">
                <div class="item-header">
                    <span class="report-id">#${report.id}</span>
                    ${statusBadge(report.status)}
                </div>
                <strong>${escapeHtml(report.title)}</strong>
                <div class="item-meta">
                    <p>${escapeHtml(report.location)}</p>
                    <span class="type-badge">${escapeHtml(report.type)}</span>
                </div>
            </button>
        `).join("");

        initIcons();
    }

    function renderHistory(history = []) {
        if (!history.length) return `<li><i data-lucide="clock" size="14"></i><span>No status history yet.</span></li>`;
        return history.slice().reverse().map(item => `
            <li>
                <i data-lucide="clipboard-check" size="14"></i>
                <span><strong>${escapeHtml(labelStatus(item.status))}</strong> by ${escapeHtml(item.by)} - ${formatDate(item.at)}<br>${escapeHtml(item.note || "")}</span>
            </li>
        `).join("");
    }

    function renderNotes(notes = []) {
        if (!notes.length) return `<p class="muted-copy">No internal notes yet.</p>`;
        return notes.slice().reverse().map(note => `
            <div class="note-item">
                <strong>${escapeHtml(note.by)} - ${formatDate(note.at)}</strong>
                <p>${escapeHtml(note.text)}</p>
            </div>
        `).join("");
    }

    function renderEvidence(evidence = []) {
        if (!evidence.length) return `<p class="muted-copy">No evidence attached yet.</p>`;
        return evidence.map(item => `
            <div class="evidence-item">
                <i data-lucide="${item.url ? "link" : "file-text"}" size="14"></i>
                <div>
                    <strong>${escapeHtml(item.kind || "evidence")}</strong>
                    <p>${escapeHtml(item.label || item.url)}</p>
                    ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open evidence</a>` : ""}
                </div>
            </div>
        `).join("");
    }

    function renderStatusFlow(report) {
        return statusFlow.map(status => {
            const icon = statusIcons[status] || "arrow-right";
            return `
            <button class="flow-step ${report.status === status ? "active" : ""}" type="button" data-update-status="${status}">
                <i data-lucide="${icon}" size="14"></i>
                ${escapeHtml(labelStatus(status))}
            </button>
        `;
        }).join("");
    }

    function updateMap(report) {
        if (!window.L || !report || !document.getElementById("incidentMap")) return;
        const coordinates = getCoordinates(report);
        if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) return;

        if (!state.mapReady) {
            state.map = L.map("incidentMap", { zoomControl: true }).setView([coordinates.lat, coordinates.lng], 14);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors"
            }).addTo(state.map);
            state.mapReady = true;
        }

        state.map.setView([coordinates.lat, coordinates.lng], 14);
        if (state.mapMarker) state.mapMarker.remove();
        state.mapMarker = L.marker([coordinates.lat, coordinates.lng])
            .addTo(state.map)
            .bindPopup(`${escapeHtml(report.title)}<br>${escapeHtml(report.location)}`);
        setTimeout(() => state.map.invalidateSize(), 50);
    }

    function resetMap() {
        if (state.map) state.map.remove();
        state.map = null;
        state.mapMarker = null;
        state.mapReady = false;
    }

    function renderDetail(report) {
        resetMap();
        if (!report) {
            elements.detail.innerHTML = `<div class="empty-state"><i data-lucide="file-search" size="32"></i><h2>Select a report</h2><p>Choose a report from the list to inspect evidence, dispatch, and location.</p></div>`;
            initIcons();
            return;
        }

        const coordinates = getCoordinates(report);
        elements.detail.innerHTML = `
            <div class="detail-header">
                <div>
                    <div class="item-header"><span class="report-id">REPORT #${report.id}</span>${statusBadge(report.status)}</div>
                    <h2>${escapeHtml(report.title)}</h2>
                    <p>${escapeHtml(report.location)} - ${formatDate(report.submittedAt)}</p>
                </div>
                <div class="detail-actions">
                    ${renderStatusFlow(report)}
                </div>
            </div>
            <div class="detail-body">
                <div>
                    <section class="panel"><h3>Report Description</h3><p class="description">${escapeHtml(report.description)}</p></section>
                    <section class="panel">
                        <h3>Reporter and Dispatch</h3>
                        <div class="meta-grid">
                            <div class="meta-item"><span>Reporter</span><strong>${escapeHtml(report.reporter)}</strong></div>
                            <div class="meta-item"><span>Mobile</span><strong>${escapeHtml(report.mobile || "Not provided")}</strong></div>
                            <div class="meta-item"><span>Assigned Unit</span><strong>${escapeHtml(report.assignedTo || "Unassigned")}</strong></div>
                            <div class="meta-item"><span>Responder</span><strong>${escapeHtml(report.dispatch?.responder || "Not assigned")}</strong></div>
                            <div class="meta-item"><span>ETA</span><strong>${report.dispatch?.etaMinutes ? `${report.dispatch.etaMinutes} min` : "Not set"}</strong></div>
                            <div class="meta-item"><span>Priority</span><strong>${priorityBadge(report.priority)}</strong></div>
                        </div>
                    </section>
                    <section class="panel"><h3>Evidence</h3><div class="evidence-list">${renderEvidence(report.evidence)}</div>
                        <div class="note-form two-column">
                            <input id="evidenceLabelInput" placeholder="Evidence note or label">
                            <input id="evidenceUrlInput" placeholder="Evidence URL">
                            <input id="evidenceFileInput" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4">
                            <button class="btn-primary" type="button" data-action="add-evidence"><i data-lucide="plus" size="14"></i> Add Evidence</button>
                        </div>
                    </section>
                    <section class="panel"><h3>Status History</h3><ul class="timeline">${renderHistory(report.history)}</ul></section>
                    <section class="panel">
                        <h3>Internal Notes</h3>
                        <div class="notes-list">${renderNotes(report.notes)}</div>
                        <div class="note-form">
                            <textarea id="reportNoteInput" rows="3" placeholder="Add internal note for responders..."></textarea>
                            <button class="btn-primary" type="button" data-action="add-note"><i data-lucide="plus" size="14"></i> Add Note</button>
                        </div>
                    </section>
                </div>
                <aside>
                    <section class="panel">
                        <h3>Incident Location</h3>
                        <div id="incidentMap" class="leaflet-map"></div>
                        <div class="map-caption-static">${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}<br>${escapeHtml(report.location)}</div>
                    </section>
                    <section class="panel">
                        <h3>Current Classification</h3>
                        <div class="meta-grid">
                            <div class="meta-item"><span>Type</span><strong><span class="type-badge">${escapeHtml(report.type)}</span></strong></div>
                            <div class="meta-item"><span>Status</span><strong>${statusBadge(report.status)}</strong></div>
                        </div>
                    </section>
                </aside>
            </div>
            <footer class="detail-footer"><i data-lucide="shield-check" size="14"></i> Workflow updates write to the backend, dispatch record, status history, and audit log.</footer>
        `;

        initIcons();
        updateMap(report);
    }

    async function loadReports({ keepSelection = true } = {}) {
        elements.list.innerHTML = `<div class="empty-state"><i data-lucide="loader-circle" size="28"></i><h2>Loading reports</h2><p>Connecting to the ResQ backend.</p></div>`;
        initIcons();

        try {
            const [reports, summary] = await Promise.all([
                window.ResQ.apiJson("/api/reports"),
                window.ResQ.apiJson("/api/reports/summary")
            ]);
            state.reports = reports;
            renderSummary(summary);

            if (!keepSelection || !state.reports.some(report => report.id === state.selectedReportId)) {
                state.selectedReportId = state.reports[0]?.id || null;
            }

            renderList();
            renderDetail(state.reports.find(report => report.id === state.selectedReportId));
        } catch (error) {
            elements.list.innerHTML = `<div class="empty-state"><i data-lucide="wifi-off" size="28"></i><h2>Reports unavailable</h2><p>${escapeHtml(error.message || "The reports service returned an error. Refresh or check deployment settings.")}</p></div>`;
            renderDetail(null);
            showToast(error.message);
            initIcons();
        }
    }

    async function updateReportStatus(status) {
        if (!state.selectedReportId) {
            showToast("Select a report first.");
            return;
        }

        const current = state.reports.find(report => report.id === state.selectedReportId);
        const note = window.prompt(`Add a dispatch note for ${labelStatus(status)}:`, "");
        if (note === null) return;

        try {
            const updated = await window.ResQ.apiJson(`/api/reports/${state.selectedReportId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    status,
                    note,
                    assignedTo: current?.assignedTo,
                    responder: current?.dispatch?.responder,
                    etaMinutes: current?.dispatch?.etaMinutes
                })
            });
            state.reports = state.reports.map(report => report.id === updated.id ? updated : report);
            renderList();
            renderDetail(updated);
            await loadReports({ keepSelection: true });
            showToast(`Report #${updated.id} marked as ${labelStatus(status)}.`);
        } catch (error) {
            showToast(error.message);
        }
    }

    async function addReportNote() {
        const input = document.getElementById("reportNoteInput");
        const text = input?.value.trim();
        if (!state.selectedReportId || !text) {
            showToast("Write a note first.");
            return;
        }

        try {
            const updated = await window.ResQ.apiJson(`/api/reports/${state.selectedReportId}/notes`, {
                method: "POST",
                body: JSON.stringify({ text })
            });
            state.reports = state.reports.map(report => report.id === updated.id ? updated : report);
            renderDetail(updated);
            showToast("Note added.");
        } catch (error) {
            showToast(error.message);
        }
    }

    async function addEvidence() {
        const label = document.getElementById("evidenceLabelInput")?.value.trim();
        const url = document.getElementById("evidenceUrlInput")?.value.trim();
        const file = document.getElementById("evidenceFileInput")?.files?.[0];
        if (!state.selectedReportId || (!label && !url && !file)) {
            showToast("Add evidence detail first.");
            return;
        }

        try {
            const updated = file
                ? await uploadEvidenceFile(state.selectedReportId, label, file)
                : await window.ResQ.apiJson(`/api/reports/${state.selectedReportId}/evidence`, {
                    method: "POST",
                    body: JSON.stringify({ kind: url ? "link" : "note", label, url })
                });
            state.reports = state.reports.map(report => report.id === updated.id ? updated : report);
            renderDetail(updated);
            showToast("Evidence added.");
        } catch (error) {
            showToast(error.message);
        }
    }

    async function uploadEvidenceFile(reportId, label, file) {
        const formData = new FormData();
        formData.append("evidence", file);
        formData.append("label", label || file.name);
        return window.ResQ.apiForm(`/api/reports/${reportId}/evidence-file`, formData);
    }

    function openCreateModal() {
        elements.modal.classList.remove("hidden");
        elements.modal.setAttribute("aria-hidden", "false");
        initIcons();
    }

    function closeCreateModal() {
        elements.modal.classList.add("hidden");
        elements.modal.setAttribute("aria-hidden", "true");
    }

    async function createReport(event) {
        event.preventDefault();
        const formData = new FormData(elements.createForm);
        const evidenceLabel = formData.get("evidenceLabel")?.trim();
        const evidenceUrl = formData.get("evidenceUrl")?.trim();
        const evidenceFile = formData.get("evidenceFile");
        const evidence = evidenceLabel || evidenceUrl
            ? [{ kind: evidenceUrl ? "link" : "note", label: evidenceLabel, url: evidenceUrl }]
            : [];

        const payload = {
            title: formData.get("title"),
            type: formData.get("type"),
            priority: formData.get("priority"),
            reporter: formData.get("reporter"),
            mobile: formData.get("mobile"),
            location: formData.get("location"),
            lat: Number(formData.get("lat")),
            lng: Number(formData.get("lng")),
            assignedTo: formData.get("assignedTo"),
            responder: formData.get("responder"),
            etaMinutes: Number(formData.get("etaMinutes")),
            description: formData.get("description"),
            evidence
        };

        try {
            const report = await window.ResQ.apiJson("/api/reports", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            if (evidenceFile?.size) {
                await uploadEvidenceFile(report.id, evidenceLabel, evidenceFile);
            }
            closeCreateModal();
            elements.createForm.reset();
            state.selectedReportId = report.id;
            await loadReports({ keepSelection: true });
            showToast(`Report #${report.id} created.`);
        } catch (error) {
            showToast(error.message);
        }
    }

    elements.list.addEventListener("click", event => {
        const item = event.target.closest(".report-item");
        if (!item) return;
        state.selectedReportId = item.dataset.id;
        renderList();
        renderDetail(state.reports.find(report => report.id === state.selectedReportId));
    });

    elements.detail.addEventListener("click", event => {
        const button = event.target.closest("[data-update-status]");
        const noteButton = event.target.closest("[data-action='add-note']");
        const evidenceButton = event.target.closest("[data-action='add-evidence']");
        if (button) updateReportStatus(button.dataset.updateStatus);
        if (noteButton) addReportNote();
        if (evidenceButton) addEvidence();
    });

    elements.typeFilter.addEventListener("change", event => {
        state.typeFilter = event.target.value;
        renderList();
    });

    elements.search.addEventListener("input", event => {
        state.search = event.target.value;
        renderList();
    });

    document.querySelectorAll("[data-action='refresh']").forEach(button => {
        button.addEventListener("click", () => loadReports({ keepSelection: true }));
    });

    document.querySelector("[data-action='workspace']").addEventListener("click", () => {
        window.location.href = "../WORKSPACE/workspace.html";
    });

    document.querySelectorAll("[data-action='open-create']").forEach(button => button.addEventListener("click", openCreateModal));
    document.querySelectorAll("[data-action='close-create']").forEach(button => button.addEventListener("click", closeCreateModal));
    elements.modal.addEventListener("click", event => {
        if (event.target === elements.modal) closeCreateModal();
    });
    elements.createForm.addEventListener("submit", createReport);

    initIcons();
    loadReports({ keepSelection: false });
});
