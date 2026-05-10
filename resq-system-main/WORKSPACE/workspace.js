if (!window.ResQ.requireAuth()) {
    throw new Error("Authentication required");
}

window.ResQ.bindLogout();
lucide.createIcons();

// Add click listeners to Enter Workspace buttons
document.querySelectorAll('.btn-enter').forEach(button => {
    button.addEventListener('click', () => {
        // Redirect to dashboard
        window.location.href = '../DASHBOARD/dashboard.html';
    });
});
