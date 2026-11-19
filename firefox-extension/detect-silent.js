"use strict";

(function () {

function getAriaLabel(el) {
  // 1. aria-labelledby
  var labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    var parts = labelledBy.split(/\s+/);
    var texts = [];
    for (var i = 0; i < parts.length; i++) {
      var ref = document.getElementById(parts[i]);
      if (ref) texts.push(ref.textContent.trim());
    }
    var joined = texts.join(" ").trim();
    if (joined) return joined;
  }

  // 2. aria-label
  var ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  // 3. <label for="id">
  if (el.id) {
    var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (label) {
      var text = label.textContent.trim();
      if (text) return text;
    }
  }

  // 4. Wrapping <label>
  var parent = el.closest("label");
  if (parent) {
    var clone = parent.cloneNode(true);
    var inputs = clone.querySelectorAll("input, textarea, select");
    for (var j = 0; j < inputs.length; j++) inputs[j].remove();
    var labelText = clone.textContent.trim();
    if (labelText) return labelText;
  }

  // 5. placeholder
  var placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return placeholder.trim();

  // 6. name or id fallback
  var name = el.name || el.id;
  if (name) return name.replace(/[_\-\[\].]+/g, " ").trim();

  return null;
}

var fields = [];
var seen = {};
var silentFinal = false;

function sendFields() {
  if (fields.length > 0 && chrome.runtime.id) {
    chrome.runtime.sendMessage({
      type: "detection",
      module: "silent",
      data: {
        domain: location.hostname,
        fields: fields.slice()
      }
    });
  }
}

function* scanFields() {
  silentFinal = false;
  var els = document.querySelectorAll("input, textarea, select");
  for (var i = 0; i < els.length; i++) {
    if (i % 16 === 15) yield;
    var el = els[i];
    var type = (el.type || "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") continue;
    if (el.offsetParent === null && type !== "password") continue;

    var label = getAriaLabel(el);
    if (!label || seen[label]) continue;
    seen[label] = true;
    fields.push(label);
  }
  sendFields();
  silentFinal = true;
}

// Leaving: send the fields found so far.
whSettle.onLeave(function () {
  if (!silentFinal) try { sendFields(); } catch (e) {}
});

// Reporting only: one scan when the page has settled (replaces the load-time
// scan plus the 2 s rescan; see settle.js).
whSettle.schedule(scanFields);

})();
