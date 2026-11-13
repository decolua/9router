document.querySelector('.cta').addEventListener('click', e => {
  e.preventDefault();
  document.querySelector('#features').scrollIntoView({behavior:'smooth'});
});

console.log('Cool Website ready ✨');