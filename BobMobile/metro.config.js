const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const chatDisplay = path.resolve(projectRoot, '../BobDesktop/packages/chat-display')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

// Resolve shared display rules from the Desktop package (single source of truth).
config.watchFolders = [...(config.watchFolders ?? []), chatDisplay]
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@bob-work/chat-display': chatDisplay,
}
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, '../BobDesktop/node_modules'),
]

module.exports = config
