const detailsControl = document.querySelector('[data-audit-token="SESSION-DETAILS-CONTROL"]');
const details = document.querySelector("#session-details");

detailsControl.addEventListener("click", () => {
  const willOpen = details.hidden;
  details.hidden = !willOpen;
  detailsControl.setAttribute("aria-expanded", String(willOpen));
  detailsControl.textContent = willOpen ? "Hide session details" : "Show session details";
});
