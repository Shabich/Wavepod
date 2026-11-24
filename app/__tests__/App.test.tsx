/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('self-test passes', () => {
  const { runSelfTest } = require('../src/prototype/selfTest');
  expect(runSelfTest()).toMatchObject({ ok: true });
});
