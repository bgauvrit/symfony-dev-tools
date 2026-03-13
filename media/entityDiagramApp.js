(function () {
  const vscode = acquireVsCodeApi();
  const graphElement = document.getElementById('graph');
  const graphSceneElement = document.getElementById('graph-scene');
  const summaryElement = document.getElementById('summary');
  const warningsElement = document.getElementById('warnings');
  const emptyStateElement = document.getElementById('empty-state');
  const domainFiltersElement = document.getElementById('domain-filters');
  const searchInputElement = document.getElementById('diagram-search-input');
  const clearFiltersButton = document.getElementById('clear-filters-button');
  const zoomInButton = document.getElementById('zoom-in-button');
  const zoomOutButton = document.getElementById('zoom-out-button');
  const zoomResetButton = document.getElementById('zoom-reset-button');
  const zoomFitButton = document.getElementById('zoom-fit-button');
  const initialState = window.__ENTITY_DIAGRAM_INITIAL_STATE__ || createEmptyState();
  const zoomState = {
    scale: 1,
    minScale: 0.15,
    maxScale: 3,
    naturalWidth: 1,
    naturalHeight: 1,
    svgElement: null,
  };
  const dragState = {
    active: false,
    moved: false,
    originX: 0,
    originY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    suppressClick: false,
  };
  let currentState = createEmptyState();
  let searchDebounceTimer = null;

  zoomInButton.addEventListener('click', function () {
    applyZoom(zoomState.scale * 1.15, true);
  });

  zoomOutButton.addEventListener('click', function () {
    applyZoom(zoomState.scale / 1.15, true);
  });

  zoomResetButton.addEventListener('click', function () {
    applyZoom(1, false);
  });

  zoomFitButton.addEventListener('click', function () {
    applyZoom(getFitScale(), false);
  });

  clearFiltersButton.addEventListener('click', function () {
    postFilterUpdate({
      query: '',
      includedDomains: currentState.domains.slice(),
    });
  });

  searchInputElement.addEventListener('input', function () {
    const nextQuery = searchInputElement.value;

    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(function () {
      postFilterUpdate({
        query: nextQuery,
        includedDomains: currentState.filterState.includedDomains.slice(),
      });
    }, 220);
  });

  domainFiltersElement.addEventListener('click', function (event) {
    const target = event.target.closest('button[data-domain]');

    if (!target) {
      return;
    }

    const domain = target.getAttribute('data-domain');

    if (!domain) {
      return;
    }

    const includedDomains = new Set(currentState.filterState.includedDomains);

    if (includedDomains.has(domain)) {
      includedDomains.delete(domain);
    } else {
      includedDomains.add(domain);
    }

    postFilterUpdate({
      query: currentState.filterState.query,
      includedDomains: Array.from(includedDomains).sort(),
    });
  });

  graphElement.addEventListener(
    'wheel',
    function (event) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      applyZoom(event.deltaY < 0 ? zoomState.scale * 1.1 : zoomState.scale / 1.1, true);
    },
    { passive: false },
  );

  graphElement.addEventListener('mousedown', function (event) {
    if (event.button !== 0 || !zoomState.svgElement) {
      return;
    }

    dragState.active = true;
    dragState.moved = false;
    dragState.originX = event.clientX;
    dragState.originY = event.clientY;
    dragState.scrollLeft = graphElement.scrollLeft;
    dragState.scrollTop = graphElement.scrollTop;
    graphElement.classList.add('is-dragging');
  });

  graphElement.addEventListener(
    'click',
    function (event) {
      if (!dragState.suppressClick) {
        return;
      }

      dragState.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  window.addEventListener('mousemove', function (event) {
    if (!dragState.active) {
      return;
    }

    const deltaX = event.clientX - dragState.originX;
    const deltaY = event.clientY - dragState.originY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragState.moved = true;
      dragState.suppressClick = true;
    }

    graphElement.scrollLeft = dragState.scrollLeft - deltaX;
    graphElement.scrollTop = dragState.scrollTop - deltaY;
  });

  window.addEventListener('mouseup', function () {
    stopDragging();
  });

  window.addEventListener('mouseleave', function () {
    stopDragging();
  });

  window.addEventListener('message', function (event) {
    const message = event.data;

    if (message && message.type === 'renderGraph') {
      renderState(message.payload);
    }
  });

  renderState(initialState);

  function renderState(payload) {
    currentState = normalizeState(payload);
    renderSummary(currentState.summary);
    renderWarnings(currentState.warnings);
    renderDomainFilters(currentState.domains, currentState.filterState.includedDomains);
    renderSearchInput(currentState.filterState.query);
    renderGraph(currentState);
    updateClearFiltersButton();
    vscode.setState(currentState);
  }

  function renderSummary(summary) {
    if (!summary) {
      summaryElement.textContent = 'No diagram loaded';
      return;
    }

    if (
      summary.visibleEntities === summary.totalEntities &&
      summary.visibleRelations === summary.totalRelations
    ) {
      summaryElement.textContent = summary.totalEntities + ' entities, ' + summary.totalRelations + ' relations';
      return;
    }

    summaryElement.textContent =
      summary.visibleEntities
      + ' of '
      + summary.totalEntities
      + ' entities, '
      + summary.visibleRelations
      + ' of '
      + summary.totalRelations
      + ' relations';
  }

  function renderWarnings(warnings) {
    if (!warnings || warnings.length === 0) {
      warningsElement.classList.add('is-hidden');
      warningsElement.innerHTML = '';
      return;
    }

    warningsElement.classList.remove('is-hidden');
    warningsElement.innerHTML = warnings
      .map(function (warning) {
        return '<p>' + escapeHtml(warning) + '</p>';
      })
      .join('');
  }

  function renderDomainFilters(domains, includedDomains) {
    if (!domains || domains.length === 0) {
      domainFiltersElement.innerHTML = '';
      return;
    }

    const includedSet = new Set(includedDomains);

    domainFiltersElement.innerHTML = domains
      .map(function (domain) {
        const activeClass = includedSet.has(domain) ? 'is-active' : '';

        return (
          '<button type="button" class="domain-filter ' + activeClass + '" data-domain="' + escapeHtmlAttribute(domain) + '">'
          + escapeHtml(domain)
          + '</button>'
        );
      })
      .join('');
  }

  function renderSearchInput(query) {
    if (searchInputElement.value !== query) {
      searchInputElement.value = query;
    }
  }

  function renderGraph(state) {
    stopDragging();
    graphSceneElement.innerHTML = '';
    zoomState.svgElement = null;

    if (!state.svg) {
      emptyStateElement.classList.remove('is-hidden');
      emptyStateElement.textContent = getEmptyStateMessage(state.summary);
      zoomResetButton.textContent = '100%';
      return;
    }

    emptyStateElement.classList.add('is-hidden');
    graphSceneElement.innerHTML = state.svg;
    zoomState.svgElement = graphSceneElement.querySelector('svg');

    if (!zoomState.svgElement) {
      emptyStateElement.classList.remove('is-hidden');
      emptyStateElement.textContent = 'The UML SVG could not be loaded.';
      return;
    }

    prepareSvg(zoomState.svgElement);
    captureNaturalSize(zoomState.svgElement);
    attachEntityHandlers(zoomState.svgElement);
    applyZoom(getFitScale(), false);
  }

  function updateClearFiltersButton() {
    const allDomainsSelected =
      currentState.domains.length === currentState.filterState.includedDomains.length
      && currentState.domains.every(function (domain) {
        return currentState.filterState.includedDomains.includes(domain);
      });

    clearFiltersButton.disabled = allDomainsSelected && currentState.filterState.query.length === 0;
  }

  function prepareSvg(svg) {
    const backgroundPolygon = svg.querySelector('g.graph > polygon');

    if (backgroundPolygon) {
      backgroundPolygon.setAttribute('fill', 'transparent');
      backgroundPolygon.setAttribute('stroke', 'none');
    }

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    svg.style.maxWidth = 'none';
    svg.style.maxHeight = 'none';
  }

  function captureNaturalSize(svg) {
    const viewBox = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;

    zoomState.naturalWidth = Math.max(viewBox && viewBox.width ? viewBox.width : svg.getBBox().width, 1);
    zoomState.naturalHeight = Math.max(viewBox && viewBox.height ? viewBox.height : svg.getBBox().height, 1);
  }

  function getFitScale() {
    const availableWidth = Math.max(graphElement.clientWidth - 80, 320);
    const availableHeight = Math.max(graphElement.clientHeight - 80, 320);
    const widthScale = availableWidth / zoomState.naturalWidth;
    const heightScale = availableHeight / zoomState.naturalHeight;

    return clampScale(Math.max(Math.min(widthScale, heightScale, 1), 0.35));
  }

  function applyZoom(nextScale, preserveCenter) {
    if (!zoomState.svgElement) {
      return;
    }

    const previousScale = zoomState.scale;
    const clampedScale = clampScale(nextScale);
    let logicalCenterX = 0;
    let logicalCenterY = 0;

    if (preserveCenter && previousScale > 0) {
      logicalCenterX = (graphElement.scrollLeft + graphElement.clientWidth / 2) / previousScale;
      logicalCenterY = (graphElement.scrollTop + graphElement.clientHeight / 2) / previousScale;
    }

    zoomState.scale = clampedScale;
    graphSceneElement.style.width = zoomState.naturalWidth * clampedScale + 'px';
    graphSceneElement.style.height = zoomState.naturalHeight * clampedScale + 'px';
    zoomResetButton.textContent = Math.round(clampedScale * 100) + '%';

    if (preserveCenter && previousScale > 0) {
      graphElement.scrollLeft = logicalCenterX * clampedScale - graphElement.clientWidth / 2;
      graphElement.scrollTop = logicalCenterY * clampedScale - graphElement.clientHeight / 2;
    } else {
      graphElement.scrollLeft = 0;
      graphElement.scrollTop = 0;
    }
  }

  function attachEntityHandlers(svg) {
    svg.querySelectorAll('a').forEach(function (anchor) {
      const href = anchor.getAttribute('href') || anchor.getAttribute('xlink:href') || '';

      if (!href.startsWith('entity://')) {
        return;
      }

      anchor.classList.add('is-entity-link');
      anchor.addEventListener('click', function (event) {
        event.preventDefault();

        if (dragState.moved) {
          return;
        }

        const entityId = decodeEntityUrl(href);

        if (!entityId) {
          return;
        }

        vscode.postMessage({
          type: 'openEntityFile',
          payload: {
            entityId: entityId,
          },
        });
      });
    });
  }

  function postFilterUpdate(nextState) {
    vscode.postMessage({
      type: 'updateFilters',
      payload: nextState,
    });
  }

  function getEmptyStateMessage(summary) {
    if (!summary || summary.totalEntities === 0) {
      return 'No Doctrine entities found in the configured roots.';
    }

    if (summary.visibleEntities === 0) {
      return 'No entity matches the current filters.';
    }

    return 'The diagram could not be rendered.';
  }

  function normalizeState(payload) {
    const summary = payload && payload.summary ? payload.summary : createEmptyState().summary;
    const domains = Array.isArray(payload && payload.domains) ? payload.domains.slice() : [];
    const filterState = payload && payload.filterState ? payload.filterState : { query: '', includedDomains: domains };
    const warnings = Array.isArray(payload && payload.warnings) ? payload.warnings.slice() : [];
    const visibleEntityIds = Array.isArray(payload && payload.visibleEntityIds) ? payload.visibleEntityIds.slice() : [];

    return {
      svg: typeof (payload && payload.svg) === 'string' ? payload.svg : undefined,
      warnings: warnings,
      domains: domains,
      filterState: {
        query: typeof filterState.query === 'string' ? filterState.query : '',
        includedDomains: Array.isArray(filterState.includedDomains)
          ? filterState.includedDomains.slice()
          : domains.slice(),
      },
      visibleEntityIds: visibleEntityIds,
      summary: summary,
    };
  }

  function createEmptyState() {
    return {
      svg: undefined,
      warnings: [],
      domains: [],
      filterState: {
        query: '',
        includedDomains: [],
      },
      visibleEntityIds: [],
      summary: {
        totalEntities: 0,
        totalRelations: 0,
        visibleEntities: 0,
        visibleRelations: 0,
      },
    };
  }

  function decodeEntityUrl(value) {
    if (!value.startsWith('entity://')) {
      return undefined;
    }

    try {
      return decodeURIComponent(value.slice('entity://'.length));
    } catch {
      return undefined;
    }
  }

  function stopDragging() {
    graphElement.classList.remove('is-dragging');
    dragState.active = false;

    if (dragState.moved) {
      window.setTimeout(function () {
        dragState.suppressClick = false;
      }, 0);
    }

    dragState.moved = false;
  }

  function clampScale(scale) {
    return Math.min(zoomState.maxScale, Math.max(zoomState.minScale, scale));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }
})();
