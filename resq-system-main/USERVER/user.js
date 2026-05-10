document.addEventListener("DOMContentLoaded", () => {
    if (!window.ResQ.requireAuth()) return;
    window.ResQ.bindLogout();
    const state = {
        users: [],
        search: "",
        status: "all"
    };

    const elements = {
        table: document.getElementById("usersTable"),
        search: document.getElementById("userSearch"),
        statusFilter: document.getElementById("statusFilter"),
        tableCount: document.getElementById("tableCount"),
        total: document.getElementById("totalUsers"),
        pending: document.getElementById("pendingUsers"),
        approved: document.getElementById("approvedUsers"),
        rejected: document.getElementById("rejectedUsers"),
        modal: document.getElementById("idModal"),
        modalTitle: document.getElementById("modalTitle"),
        modalIdType: document.getElementById("modalIdType"),
        modalResident: document.getElementById("modalResident"),
        modalAddress: document.getElementById("modalAddress"),
        modalDecisions: document.getElementById("modalDecisions"),
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

    function formatDate(value) {
        return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(value));
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add("show");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
    }

    function badge(status) {
        return `<span class="badge b-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
    }

    function filteredUsers() {
        const term = state.search.trim().toLowerCase();

        return state.users.filter(user => {
            const matchesStatus = state.status === "all" || user.status === state.status;
            const searchable = [user.fullName, user.mobile, user.submittedId, user.address, user.status].join(" ").toLowerCase();
            return matchesStatus && (!term || searchable.includes(term));
        });
    }

    function renderSummary() {
        elements.total.textContent = state.users.length;
        elements.pending.textContent = state.users.filter(user => user.status === "pending").length;
        elements.approved.textContent = state.users.filter(user => user.status === "approved").length;
        elements.rejected.textContent = state.users.filter(user => user.status === "rejected").length;
    }

    function renderTable() {
        const users = filteredUsers();
        elements.tableCount.textContent = `Showing ${users.length} of ${state.users.length} users`;

        if (!users.length) {
            elements.table.innerHTML = `<tr><td colspan="6" class="empty-row">No users match the current filters.</td></tr>`;
            return;
        }

        elements.table.innerHTML = users.map(user => `
            <tr>
                <td>
                    <div class="user-info">
                        <div class="user-icon"><i data-lucide="user" size="14"></i></div>
                            <span>${escapeHtml(user.fullName)}</span>
                    </div>
                </td>
                <td>${escapeHtml(user.mobile)}</td>
                <td><div class="id-thumb"><i data-lucide="contact-2" size="16"></i></div></td>
                <td>${formatDate(user.registeredAt)}</td>
                <td>${badge(user.status)}</td>
                <td class="text-right">
                    <div class="row-actions">
                        <button class="link-btn" type="button" data-view-id="${user.id}">View ID</button>
                        ${user.status !== "approved" ? `<button class="btn-action btn-approve" type="button" data-update-user="${user.id}" data-status="approved">Approve</button>` : ""}
                        ${user.status !== "rejected" ? `<button class="btn-action btn-reject" type="button" data-update-user="${user.id}" data-status="rejected">Reject</button>` : ""}
                    </div>
                </td>
            </tr>
        `).join("");

        initIcons();
    }

    async function loadUsers() {
        elements.table.innerHTML = `<tr><td colspan="6" class="empty-row">Loading users from backend...</td></tr>`;

        try {
            state.users = await window.ResQ.apiJson("/api/users");
            renderSummary();
            renderTable();
        } catch (error) {
            elements.table.innerHTML = `<tr><td colspan="6" class="empty-row">Backend unavailable. Start the server and refresh.</td></tr>`;
            showToast(error.message);
        }
    }

    async function updateUser(id, status) {
        const user = state.users.find(item => item.id === id);
        const note = window.prompt(`Add a ${status} note for ${user?.fullName || "this user"}:`, "");
        if (note === null) return;

        try {
            const updated = await window.ResQ.apiJson(`/api/users/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ status, note })
            });

            state.users = state.users.map(user => user.id === updated.id ? updated : user);
            renderSummary();
            renderTable();
            showToast(`${updated.fullName} marked as ${status}.`);
        } catch (error) {
            showToast(error.message);
        }
    }

    function openIdModal(user) {
        elements.modalTitle.textContent = `Submitted ID: ${user.fullName}`;
        elements.modalIdType.textContent = user.submittedId;
        elements.modalResident.textContent = user.mobile;
        elements.modalAddress.textContent = user.address;
        elements.modalDecisions.innerHTML = (user.decisions || []).length
            ? (user.decisions || []).slice().reverse().map(item => `<p><strong>${escapeHtml(item.status)}</strong> by ${escapeHtml(item.by)}: ${escapeHtml(item.note)}</p>`).join("")
            : "<p>No verification notes yet.</p>";
        elements.modal.showModal();
        initIcons();
    }

    elements.table.addEventListener("click", event => {
        const viewButton = event.target.closest("[data-view-id]");
        const updateButton = event.target.closest("[data-update-user]");

        if (viewButton) {
            const user = state.users.find(item => item.id === Number(viewButton.dataset.viewId));
            if (user) openIdModal(user);
        }

        if (updateButton) {
            updateUser(Number(updateButton.dataset.updateUser), updateButton.dataset.status);
        }
    });

    elements.search.addEventListener("input", event => {
        state.search = event.target.value;
        renderTable();
    });

    elements.statusFilter.addEventListener("change", event => {
        state.status = event.target.value;
        renderTable();
    });

    document.querySelectorAll("[data-action='refresh']").forEach(button => {
        button.addEventListener("click", loadUsers);
    });

    document.querySelector("[data-action='workspace']").addEventListener("click", () => {
        window.location.href = "../WORKSPACE/workspace.html";
    });

    document.querySelector("[data-action='close-modal']").addEventListener("click", () => {
        elements.modal.close();
    });

    document.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => showToast("All loaded users are shown on this page."));
    });

    initIcons();
    loadUsers();
});
