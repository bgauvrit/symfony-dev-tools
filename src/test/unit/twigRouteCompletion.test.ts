import * as assert from 'node:assert/strict';

import { routeParamSnippet } from '../../features/web/indexer';
import { findTwigRouteCallAt, parseTwigRouteCalls } from '../../features/web/twig';

describe('Twig route parsing', () => {
  it('parses path calls with params objects and merge expressions', () => {
    const text =
      "{{ path('app_product_show_locale', { _locale: app.request.locale, slug: product.slug }|merge(extraParams)) }}";
    const calls = parseTwigRouteCalls(text);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.routeName, 'app_product_show_locale');
    assert.deepEqual(calls[0]?.existingParamKeys, ['_locale', 'slug']);
    assert.equal(Boolean(calls[0]?.paramsObjectRange), true);
  });

  it('finds the active call at a cursor offset and builds smart param snippets', () => {
    const text = "{{ path('app_product_show_locale') }}";
    const offset = text.indexOf('show_locale') + 2;
    const call = findTwigRouteCallAt(text, offset);

    assert.ok(call);
    assert.equal(call?.routeName, 'app_product_show_locale');
    assert.equal(routeParamSnippet('_locale', 1), '_locale: app.request.locale');
    assert.equal(routeParamSnippet('slug', 2), 'slug: ${2:slug}');
    assert.equal(routeParamSnippet('page', 3), 'page: ${3:page}');
  });
});
