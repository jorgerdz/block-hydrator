function getResourceExtension(path) {
    return path.match(/\.[0-9a-z]+$/i)[0];
}

function getResourceLoadStrategy(url, component) {
    let extension = getResourceExtension(url);
    let strategy = {
        type: extension,
        fetch: null,
        execute: null,
        url: url
    };
    if (extension === '.js') {
        strategy.fetch = fetchJs.bind(this, url, component.element);
        strategy.execute = executeJs.bind(this, url, component.element);
    }
    if (extension === '.css') {
        strategy.fetch = loadCss.bind(this, url, component.element);
    }
    if (extension === '.html') {
        strategy.fetch = loadHtml.bind(this, url, component.element);
    }
    return strategy;
}

async function fetchJs(url) {
    // taking advantage of browser cache
    // script tag would come from cache after fetch is done
    console.log('fetch js')
    await fetch(url, {
        mode: 'no-cors'
    })
}

async function executeJs(url) {
    let script = document.createElement('script');
    script.src = url;
    script.type = "module";
    console.log('execute js ' + url);
    document.head.appendChild(script);
}

async function loadCss(url) {
    var link = document.createElement("link");
    link.type = "text/css";
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
    console.log('loading css ' + url);
}

async function loadHtml(url, parent) {
    let res = await fetch(url);
    let body = await res.text();
    let html = stringToHTML(body);
    parent.appendChild(html);
    console.log('loading html ' + url);
}

function stringToHTML(str) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(str, 'text/html');
    return doc.body;
};

async function loadComponent(component) {
    let strategies = component.src.map((src) => {
        return getResourceLoadStrategy(src, component)
    });

    function getBuilder(strategy) {
        return strategy.fetch;
    }

    let html = strategies.filter(strategy => strategy.type === '.html').map(getBuilder)
    let css = strategies.filter(strategy => strategy.type === '.css').map(getBuilder)
    let js = strategies.filter(strategy => strategy.type === '.js')

    let jsFetch = js.map(strategy => strategy.fetch)
    let jsExecute = js.map(strategy => strategy.execute)

    // css can be executed whenever and we don't care about when it completes
    Promise.all(css.map(builder => builder()))
    // html and js can fetch at the same time, html autoexecutes
    await Promise.all([...html, ...jsFetch].map(builder => builder()))
    console.log('finished html and js fetch')
    // js needs to be executed last in case html is a dependency
    await Promise.all(jsExecute.map(builder => builder()))
    console.log('finished hydration: js')
}

function parseSrcset(element) {
    let src = element.dataset.srcset;
    let srcs = src.split(',');
    let component = {
        element: element,
        src: srcs
    }
    return component;
}

function hydrate(elements) {
    let element;
    elements
        .filter(el => el.dataset.srcset)
        .map(parseSrcset)
        .map(loadComponent)
}

function intersectionObserver() {
  let registrars = {};
  function onIntersection(elements) {
    let lazyElements = elements
        .filter(el => el.isIntersecting)
        .map(el => el.target)
        .map(el => {
          let registrar = registrars[el.dataset.srcset]
          observer.unobserve(el);
          if (registrar) {
            console.log('resolving intersection ' + el.dataset.srcset);
            registrar();
          }
        });
  }

  let observer = new IntersectionObserver(onIntersection, {
      margin: "100px"
  });
  let lazyElements = [...document.querySelectorAll('.lazy')];
  lazyElements.forEach(observer.observe.bind(observer));

  return function(element) {
    return new Promise((resolve, reject) => {
      registrars[element.dataset.srcset] = resolve;
    });
  }
}

let observe = intersectionObserver();

let idleListener = function() {
  let idlePromise = new Promise((resolve, reject) => {
    window.requestIdleCallback(resolve);
  })
  return function() {
    return idlePromise;
  }
}
let idle = idleListener();

function clickListener(element) {
  return new Promise(function(resolve) {
      performance.mark('click')
      let _clickLoadListener = function() {
        element.removeEventListener('click', element._clickLoadListener)
        element._clickLoadListener = null; 
        console.log('resolving click ' + element.dataset.srcset);
        resolve();
      }
      element._clickLoadListener = _clickLoadListener;
      element.addEventListener('click', _clickLoadListener)
    })
}

let directives = {
  "idle": idle,
  "click": clickListener,
  "lazy": observe
}

let hydratableElements = document.querySelectorAll(Object.keys(directives).map(dir => '.' + dir).join(','))
hydratableElements.forEach(element => {
  let classes = element.classList.value.split(' ');
  let matchingDirectives = classes.filter(c => Object.keys(directives).includes(c))
  let strategies = matchingDirectives.map(d => directives[d].call(this, element))

  Promise.all(strategies).then(hydrate.bind(this, [element]))
})
