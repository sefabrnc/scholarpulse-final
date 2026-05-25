const input = document.getElementById("apiBase");
const saveButton = document.getElementById("save");

chrome.storage.sync.get(["apiBase"], (stored) => {
  if (typeof stored.apiBase === "string") {
    input.value = stored.apiBase;
  }
});

saveButton.addEventListener("click", () => {
  const value = input.value.trim();
  chrome.storage.sync.set({ apiBase: value || "http://127.0.0.1:8787" }, () => {
    saveButton.textContent = "Saved";
    setTimeout(() => {
      saveButton.textContent = "Save";
    }, 900);
  });
});
