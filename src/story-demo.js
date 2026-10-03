// === STORY:DEMO BEGIN ===
(function () {
  'use strict';
  // The demo bundles are real Day 148 Final exports, made by running Day 148's own page on its own Day 147 fixtures
  // (test/make-demo.js): seed 42, the whole world generated, Final exported with baking off. One Day 146 shaped edit
  // first raises the chapters' target minutes to the 12 hour floor. They are embedded as JSON.
  //   demo  The Day 146 demo saga: two chapters on Westland and Eastland, 360 minutes each, two endings, chapter one's
  //         boss slot empty.
  //   four  Six chapters on four continents, 780 minutes, Westland and Southmere each shared by two chapters, The
  //         Marches with an empty boss slot, two side quests with givers, one ending.
  var U = Kit.util;
  var DEMO = window.STORY_DEMO = {};
  var DEMO_JSON = /*DEMO_JSON*/null;
  var FOUR_JSON = /*FOUR_JSON*/null;
  DEMO.FIXTURES = [
    { key: 'demo', label: 'Demo saga', purpose: 'Two chapters on two continents with two endings, as Days 146 to 148 ship it, at the 12 hour floor.' },
    { key: 'four', label: 'Four continents', purpose: 'Six chapters on four continents, ship and airship, an empty boss slot, and two side quests with givers.' }
  ];
  DEMO.bundle = function () { return U.clone(DEMO_JSON); };
  DEMO.fixture = function (key) {
    if (key === 'demo') return U.clone(DEMO_JSON);
    if (key === 'four') return U.clone(FOUR_JSON);
    throw new Error('Unknown fixture ' + key);
  };
})();
// === STORY:DEMO END ===
