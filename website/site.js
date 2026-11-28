/* global document, navigator, setTimeout, window */
document.querySelector('a[href="#privacy"]').addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('#privacy').showModal();
});
document.querySelector('#privacy').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector('[data-copy]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.querySelector('p').textContent = 'Copied';
    setTimeout(() => {
      button.querySelector('p').textContent = 'Copy command';
    }, 1800);
  } catch {
    window.prompt('Run this command in your terminal:', button.dataset.copy);
  }
});
