# PROJ-11: Remove systemd deployment references (Docker migration)

Eliminar todas las referencias al deployment via systemd (sai-dashboard-api.service) en favor de Docker + GitHub CI/CD. Ver plan en docs/plans/2026-02-21-remove-systemd-deployment.md. 9 sub-tareas cubren: install-production.sh, tunnel service deps, README, DEPLOYMENT.md, scripts de validación, tests, docs restantes, sudoers, y verificación final.
