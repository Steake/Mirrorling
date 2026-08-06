document.documentElement.dataset.checkoutOverlay = "ready";

document.querySelector("#load-recommendation")?.addEventListener("click", async () => {
  const output = document.querySelector("#recommendation-result");
  if (!(output instanceof HTMLOutputElement)) return;

  output.value = "Loading…";
  try {
    const response = await fetch("/api/recommendation", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    output.value = `${result.title}: ${result.detail}`;
  } catch (error) {
    output.value = error instanceof Error ? error.message : "Recommendation failed.";
  }
});
