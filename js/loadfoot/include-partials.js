// include-footer.js
// Loads the shared footer partial into any page that has:
//   <div data-include="partials/footer.html"></div>
//
// Usage — add this near the bottom of each page, after your other scripts:
//   <script type="module" src="js/include-footer.js"></script>

async function loadFooter() {
  const placeholder = document.querySelector('[data-include="partials/footer.html"]');
  if (!placeholder) return;

  try {
    const res = await fetch('partials/footer.html', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load footer: ${res.status}`);
    const html = await res.text();
    placeholder.outerHTML = html;

    // Set the copyright year now that the footer markup exists in the DOM
    document.querySelectorAll('.js-year').forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  } catch (err) {
    console.error('[include-footer]', err);
  }
}

document.addEventListener('DOMContentLoaded', loadFooter);