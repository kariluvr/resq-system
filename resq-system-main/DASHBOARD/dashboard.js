document.addEventListener("DOMContentLoaded", async () => {
    if (!window.ResQ.requireAuth()) return;
    window.ResQ.bindLogout();
    if (window.lucide) window.lucide.createIcons();

    const fields = {
        verificationCount: document.getElementById("verificationCount"),
        reportCount: document.getElementById("reportCount"),
        riskCount: document.getElementById("riskCount"),
        responderCount: document.getElementById("responderCount"),
        verificationFooter: document.querySelector("#verificationCount + .stat-footer"),
        reportFooter: document.querySelector("#reportCount + .stat-footer"),
        riskFooter: document.querySelector("#riskCount + .stat-footer"),
        activityList: document.querySelector(".activity-list"),
        mapLegend: document.querySelector(".map-legend"),
        latestNewsWidget: document.getElementById("latestNewsWidget")
    };

    function statusLabel(status) {
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    try {
        const data = await window.ResQ.apiJson("/api/dashboard");

        fields.verificationCount.textContent = data.users.total;
        fields.reportCount.textContent = data.reports.total;
        fields.riskCount.textContent = data.reports.critical;
        fields.responderCount.textContent = data.responders;
        fields.verificationFooter.textContent = `${data.users.pending} pending verification`;
        fields.reportFooter.textContent = `${data.reports.received} received reports`;
        fields.riskFooter.textContent = `${data.reports.critical} critical incidents`;

        const countsByType = data.recentReports.reduce((counts, report) => {
            counts[report.type] = (counts[report.type] || 0) + 1;
            return counts;
        }, {});

        fields.mapLegend.innerHTML = Object.entries(countsByType)
            .map(([type, count]) => `<div><span class="dot ${type.toLowerCase()}"></span> ${escapeHtml(type)} (${count})</div>`)
            .join("");

        fields.activityList.innerHTML = data.recentReports.map(report => `
            <div class="activity-item">
                <div class="icon-box ${report.priority === "critical" ? "red-bg" : "green-bg"}">
                    <i data-lucide="${report.priority === "critical" ? "alert-triangle" : "file-text"}" size="14"></i>
                </div>
                <div class="activity-details">
                    <strong>${escapeHtml(report.title)}</strong>
                    <span>${escapeHtml(report.location)} - ${statusLabel(report.status).replaceAll("_", " ")}</span>
                </div>
                <span class="tag ${report.priority === "critical" ? "red" : "green-text"}">${escapeHtml(report.type)}</span>
            </div>
        `).join("");

        fields.latestNewsWidget.innerHTML = (data.news?.latest || []).length
            ? data.news.latest.map(item => `
                <div class="alert-box ${item.priority === "Emergency" ? "yellow-bg" : "gray-bg"}" style="margin-top: 10px;">
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.category)} - ${escapeHtml(item.priority)} - ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.publishedAt))}</p>
                </div>
            `).join("")
            : `<div class="alert-box gray-bg"><strong>No announcements yet</strong><p>Create one from the News module.</p></div>`;

        if (window.lucide) window.lucide.createIcons();
    } catch (error) {
        fields.activityList.innerHTML = `<div class="activity-item"><strong>${escapeHtml(error.message)}</strong></div>`;
    }
});
