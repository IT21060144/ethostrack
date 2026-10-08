// Expected log lines (rejected tokens, erasure notices) would bury the test
// report; console.error is left on so real server errors still show.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
