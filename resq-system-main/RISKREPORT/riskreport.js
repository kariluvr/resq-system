// RISKREPORT/riskreport.js

document.addEventListener("DOMContentLoaded", async () => {

    // =========================
    // AUTH
    // =========================

    if (window.ResQ?.requireAuth && !window.ResQ.requireAuth()) {
        return;
    }

    if (window.ResQ?.bindLogout) {
        window.ResQ.bindLogout();
    }

    if (window.lucide) {
        lucide.createIcons();
    }

    // =========================
    // ELEMENTS
    // =========================

    const barangaySelect = document.getElementById("barangaySelect");
    const generateRiskBtn = document.getElementById("generateRiskBtn");

    const runSimulationBtn = document.getElementById("runSimulationBtn");

    const riskResultContainer = document.getElementById("riskResultContainer");
    const simulationResults = document.getElementById("simulationResults");

    const historyContainer = document.getElementById("historyContainer");

    const totalAssessments = document.getElementById("totalAssessments");
    const highRiskCount = document.getElementById("highRiskCount");
    const moderateRiskCount = document.getElementById("moderateRiskCount");
    const safeCount = document.getElementById("safeCount");

    // =========================
    // HELPERS
    // =========================

    function escapeHtml(value = "") {

        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function authHeaders() {

        const token = localStorage.getItem("token");

        return {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };
    }

    function getRiskClass(level = "") {

        level = String(level).toUpperCase();

        if (level === "LOW") return "low";
        if (level === "MODERATE") return "moderate";
        if (level === "HIGH") return "high";

        return "critical";
    }

    function showLoading(container, message = "Loading...") {

        container.innerHTML = `
            <div class="loading">
                ${escapeHtml(message)}
            </div>
        `;
    }

    // =========================
    // SUMMARY
    // =========================

    async function loadSummary() {

        try {

            const response = await fetch("/api/risk-report/summary", {
                headers: authHeaders()
            });

            const data = await response.json();

            totalAssessments.textContent = data.total || 0;
            highRiskCount.textContent = data.high || 0;
            moderateRiskCount.textContent = data.moderate || 0;
            safeCount.textContent = data.low || 0;

        } catch (error) {

            console.error(error);

        }

    }

    // =========================
    // HISTORY
    // =========================

    async function loadHistory(barangay = "") {

        try {

            showLoading(historyContainer, "Loading assessment history...");

            const endpoint = barangay
                ? `/api/risk-report/history/${encodeURIComponent(barangay)}`
                : `/api/risk-report/history`;

            const response = await fetch(endpoint, {
                headers: authHeaders()
            });

            const history = await response.json();

            if (!history.length) {

                historyContainer.innerHTML = `
                    <div class="empty-state">
                        No assessment history available
                    </div>
                `;

                return;
            }

            historyContainer.innerHTML = history.map(item => `

                <div class="history-item">

                    <div>

                        <h4>
                            ${escapeHtml(item.barangay)}
                        </h4>

                        <p>
                            ${new Date(item.calculatedAt).toLocaleString()}
                        </p>

                    </div>

                    <div class="risk-badge ${getRiskClass(item.riskLevel)}">
                        ${escapeHtml(item.riskLevel)}
                    </div>

                </div>

            `).join("");

        } catch (error) {

            console.error(error);

            historyContainer.innerHTML = `
                <div class="empty-state">
                    Failed to load history
                </div>
            `;
        }

    }

    // =========================
    // RISK REPORT
    // =========================

    generateRiskBtn.addEventListener("click", async () => {

        const barangay = barangaySelect.value;

        if (!barangay) {

            alert("Please select a barangay.");

            return;
        }

        try {

            showLoading(
                riskResultContainer,
                "Generating ML disaster assessment..."
            );

            const response = await fetch(
                `/api/risk-report/${encodeURIComponent(barangay)}`,
                {
                    headers: authHeaders()
                }
            );

            const data = await response.json();

            renderRiskResult(data);

            await saveRiskReport(data);

            await loadHistory(barangay);

            await loadSummary();

        } catch (error) {

            console.error(error);

            riskResultContainer.innerHTML = `
                <div class="empty-state large">
                    Failed to generate risk report
                </div>
            `;
        }

    });

    // =========================
    // SAVE REPORT
    // =========================

    async function saveRiskReport(data) {

        try {

            await fetch("/api/risk-report", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify(data)
            });

        } catch (error) {

            console.error(error);

        }

    }

    // =========================
    // RENDER RESULT
    // =========================

    function renderRiskResult(data) {

        const riskClass = getRiskClass(data.risk_level);

        riskResultContainer.innerHTML = `

            <div class="result-card">

                <div class="result-header">

                    <div>

                        <h2>
                            ${escapeHtml(data.barangay)}
                        </h2>

                        <p>
                            ML-Based Disaster Risk Assessment
                        </p>

                    </div>

                    <div class="risk-badge ${riskClass}">
                        ${escapeHtml(data.risk_level)}
                    </div>

                </div>

                <div class="weather-grid">

                    <div class="weather-box">
                        <span>Rainfall</span>
                        <strong>${data.rainfall ?? 0} mm</strong>
                    </div>

                    <div class="weather-box">
                        <span>Humidity</span>
                        <strong>${data.humidity ?? 0}%</strong>
                    </div>

                    <div class="weather-box">
                        <span>Wind Speed</span>
                        <strong>${data.wind_speed ?? 0} km/h</strong>
                    </div>

                    <div class="weather-box">
                        <span>Risk Score</span>
                        <strong>${data.risk_score ?? 0}</strong>
                    </div>

                </div>

                <div class="recommendation-list">

                    ${(data.recommendations || []).map(item => `

                        <div class="recommendation-item">
                            ${escapeHtml(item)}
                        </div>

                    `).join("")}

                </div>

            </div>

        `;

        if (window.lucide) {
            lucide.createIcons();
        }

    }

    // =========================
    // SIMULATION
    // =========================

    runSimulationBtn.addEventListener("click", () => {

        const barangay = document.getElementById("simBarangay").value;

        const disasterType =
            document.getElementById("simDisasterType").value;

        const rainfall =
            Number(document.getElementById("simRainfall").value);

        const humidity =
            Number(document.getElementById("simHumidity").value);

        const wind =
            Number(document.getElementById("simWind").value);

        const temp =
            Number(document.getElementById("simTemp").value);

        if (!barangay) {

            alert("Barangay is required.");

            return;
        }

        let score = 0;

        score += rainfall * 2;
        score += humidity * 0.5;
        score += wind * 1.2;

        let riskLevel = "LOW";
        let severity = "Minor";

        if (score >= 160) {

            riskLevel = "CRITICAL";
            severity = "Extreme";

        } else if (score >= 100) {

            riskLevel = "HIGH";
            severity = "Severe";

        } else if (score >= 60) {

            riskLevel = "MODERATE";
            severity = "Moderate";
        }

        const riskClass = getRiskClass(riskLevel);

        const recommendations =
            generateRecommendations(riskLevel);

        simulationResults.innerHTML = `

            <div class="result-card">

                <div class="result-header">

                    <div>

                        <h2>
                            ${escapeHtml(barangay)}
                        </h2>

                        <p>
                            ${escapeHtml(disasterType)} Simulation Result
                        </p>

                    </div>

                    <div class="risk-badge ${riskClass}">
                        ${riskLevel}
                    </div>

                </div>

                <div class="weather-grid">

                    <div class="weather-box">
                        <span>Estimated Severity</span>
                        <strong>${severity}</strong>
                    </div>

                    <div class="weather-box">
                        <span>Flood Depth</span>
                        <strong>${Math.floor(rainfall / 10)} ft</strong>
                    </div>

                    <div class="weather-box">
                        <span>Evacuation Need</span>
                        <strong>
                            ${riskLevel === "HIGH" || riskLevel === "CRITICAL"
                                ? "YES"
                                : "MONITOR"}
                        </strong>
                    </div>

                    <div class="weather-box">
                        <span>Temperature</span>
                        <strong>${temp}°C</strong>
                    </div>

                </div>

                <div class="recommendation-list">

                    ${recommendations.map(item => `

                        <div class="recommendation-item">
                            ${escapeHtml(item)}
                        </div>

                    `).join("")}

                </div>

            </div>

        `;

    });

    // =========================
    // RECOMMENDATIONS
    // =========================

    function generateRecommendations(riskLevel) {

        if (riskLevel === "CRITICAL") {

            return [
                "Immediate evacuation is recommended.",
                "Deploy emergency responders immediately.",
                "Activate emergency response operations center.",
                "Send emergency SMS alerts to residents."
            ];
        }

        if (riskLevel === "HIGH") {

            return [
                "Prepare evacuation facilities.",
                "Coordinate with barangay responders.",
                "Monitor residents in danger zones."
            ];
        }

        if (riskLevel === "MODERATE") {

            return [
                "Prepare response teams.",
                "Monitor incoming weather conditions.",
                "Advise residents to remain alert."
            ];
        }

        return [
            "Continue monitoring weather conditions.",
            "Maintain preparedness procedures."
        ];
    }

    // =========================
    // REFRESH
    // =========================

    document.getElementById("refreshBtn")
        .addEventListener("click", () => {

            loadSummary();

            loadHistory();

        });

    // =========================
    // INIT
    // =========================

    await loadSummary();

    await loadHistory();

});