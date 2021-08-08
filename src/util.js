const chalk = require('chalk')

module.exports = {
  parseRepo(repoPath) {
    const [owner, repo] = repoPath.split('/')

    if (!repo) {
      throw new Error('Wrong format of repo')
    }

    return { owner, repo }
  },
  httpRequestErrorHandler(err) {
    if (
      err.response.status === 403 &&
      err.response.data.message.includes === 'rate limit exceeded'
    ) {
      console.log('Rate limit exceeded...')
      return
    }
    console.error(chalk.red(err))
    console.dir(err.response.data, { colors: true, depth: 4 })
  },
}
