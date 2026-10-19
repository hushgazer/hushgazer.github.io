(function () {
  'use strict';
  var ongoing = document.getElementById('projects-ongoing');
  var finished = document.getElementById('projects-finished');
  var admin = window.HushAdmin && window.HushAdmin.active;

  function empty(ul, text) {
    ul.textContent = '';
    var li = document.createElement('li');
    li.className = 'project-empty';
    li.textContent = text || 'None yet.';
    ul.appendChild(li);
  }

  function addClient(ul, p) {
    var li = document.createElement('li'), a = document.createElement('a');
    a.href = p.slug + '/';
    a.textContent = p.title;
    if (p.description) {
      var s = document.createElement('small');
      s.textContent = p.description;
      a.appendChild(s);
    }
    li.appendChild(a);
    ul.appendChild(li);
  }

  fetch('projects/projects.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var projects = d.projects || [];
      if (admin && window.HushAdmin.renderHome) {
        window.HushAdmin.renderHome(ongoing, finished, projects);
        return;
      }
      ongoing.textContent = '';
      finished.textContent = '';
      var o = projects.filter(function (p) { return !p.hidden && !p.finished; });
      var f = projects.filter(function (p) { return !p.hidden && p.finished; });
      if (!o.length) empty(ongoing);
      else o.forEach(function (p) { addClient(ongoing, p); });
      if (!f.length) empty(finished);
      else f.forEach(function (p) { addClient(finished, p); });
    })
    .catch(function () {
      if (ongoing) empty(ongoing, 'Could not load projects.');
      if (finished) empty(finished, 'Could not load projects.');
    });
})();
