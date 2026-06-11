document.querySelector(".contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const status = form.querySelector(".form-status");
  const payload = Object.fromEntries(new FormData(form).entries());

  button.disabled = true;
  button.textContent = "Sending...";
  status.textContent = "";

  try {
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to submit your request.");
    }

    form.reset();
    status.textContent = result.emailSent
      ? "Thanks - your request was sent to our sales team."
      : "Thanks - your request was received and queued for the sales team.";
  } catch (error) {
    status.textContent = "We could not send the request. Please email sales@herculeantechnologies.com.";
  } finally {
    button.disabled = false;
    button.textContent = "Request a consultation";
  }
});
