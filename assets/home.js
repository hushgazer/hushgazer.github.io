(function () {
  'use strict';
  var ul = document.getElementById('projects');
  fetch('projects/projects.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      ul.textContent = '';
      (d.projects || []).filter(function (p) { return !p.hidden; }).forEach(function (p) {
        var li = document.createElement('li'), a = document.createElement('a');
        a.href = p.slug + '/';
        a.textContent = p.title;
        if (p.description) { var s = document.createElement('small'); s.textContent = p.description; a.appendChild(s); }
        li.appendChild(a); ul.appendChild(li);
      });
    })
    .catch(function () { ul.textContent = 'Could not load projects.'; });
})();
