module.exports = {
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "./tsconfig.dev.json"
  },
  ignorePatterns: ["src/resources/**/*"],
  overrides: [
    {
      files: ["*.config.ts", "*.config.js"],
      rules: {
        "import/no-extraneous-dependencies": ["error", { "devDependencies": true }]
      }
    }
  ]
};
