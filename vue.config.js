const { defineConfig } = require('@vue/cli-service');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const schemaDirectories = [
  'behavior',
  'general',
  'language',
  'resource',
  'skinpacks'
];

module.exports = defineConfig({
  transpileDependencies: true,
  publicPath: '',

  configureWebpack: {
    plugins: [
      new CopyWebpackPlugin({
        patterns: schemaDirectories.map((dir) => ({
          from: `schemas/${dir}`,
          to: `schemas/${dir}`,
          filter: (path) => path.toLowerCase().endsWith('.json')
        }))
      })
    ]
  },

  pluginOptions: {
    i18n: {
      locale: 'zh',
      fallbackLocale: 'zh',
      localeDir: 'locales',
      enableLegacy: false,
      runtimeOnly: false,
      compositionOnly: false,
      fullInstall: true
    }
  }
})
