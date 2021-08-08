const chalk = require('chalk'),
  config = require('./config'),
  axios = require('axios'),
  { program } = require('commander'),
  { parseRepo, httpRequestErrorHandler } = require('./util'),
  parseLinkHeader = require('parse-link-header'),
  { URL } = require('url'),
  cliProgress = require('cli-progress'),
  moment = require('moment'),
  leftPad = require('left-pad'),
  formatBar = require('cli-progress/lib/format-bar')
// Note 1: This program lists only users with comments. Users with commits but without comments will not be listed.

// Log GitHub token info.
console.log(chalk.yellow('Your github token is:'))
console.info(chalk.yellow(config.GITHUB_PERSONAL_ACCESS_TOKEN))

// Prepare CLI.
program
  .description('GitHub comments report')
  .option('--repo <repo>', 'Repo')
  .option('--period <period>', 'Period', '0d')

program.parse()

const options = program.opts()

const { period, repo: repoPath } = options,
  { owner, repo } = parseRepo(repoPath)

// Validate period. Note: only days are supported (hours/months/years could be added easily though).
const periodQuantity = Number(period.substring(0, period.length - 1))
if (isNaN(periodQuantity)) {
  throw Error('Wrong period.')
}
const periodType = period.substring(period.length - 1)
if (periodType !== 'd') {
  throw Error(`Period type \`${periodType}\` is not supported.`)
}

// Configure HTTP requests.
const apiBase = 'https://api.github.com'

const http = axios.create({
  baseURL: apiBase,
  headers: {
    Authorization: `token ${config.GITHUB_PERSONAL_ACCESS_TOKEN}`,
  },
})

const rateLimitState = { current: 0, total: 0 }

// eslint-disable-next-line space-before-function-paren
const processAllPages = async (urlPathname, resultProcessor) => {
  let nextPathname = urlPathname,
    // eslint-disable-next-line camelcase
    params = { per_page: 100 }

  const progressBar = new cliProgress.SingleBar(
    {
      format: (options, { eta, value, total, progress }) =>
        `${urlPathname} [${formatBar(
          progress,
          options,
        )}] | ETA: ${eta}s | page ${value}/${total}, rate limit: ${
          rateLimitState.current
        }/${rateLimitState.total}`,
    },
    cliProgress.Presets.shades_classic,
  )

  let progressBarStarted = false

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await http
      .get(nextPathname, { params })
      .catch(httpRequestErrorHandler)

    let linkInfo

    // Process the data chunk.
    if (response) {
      if (response.data) {
        resultProcessor(response.data)
      }

      // Parse the link header and reassign url to the next one.
      linkInfo = parseLinkHeader(response.headers.link)

      const rateLimit = Number(response.headers['x-ratelimit-limit']),
        rateLimitRemaining = Number(response.headers['x-ratelimit-remaining'])

      if (!isNaN(rateLimit) && !isNaN(rateLimitRemaining)) {
        rateLimitState.total = rateLimit
        rateLimitState.current = rateLimit - rateLimitRemaining
      }
    }

    if (!progressBarStarted) {
      // If no linkInfo then it's just one page or no items at all.
      if (!linkInfo) {
        progressBar.start(1, 1)
      } else {
        progressBar.start(linkInfo.last.page, 1)
      }
      progressBarStarted = true
    } else {
      progressBar.update(Number(params.page))
    }

    // Stop if no next url.
    if (!linkInfo || !linkInfo.next) {
      progressBar.stop()
      break
    }

    // Prepare next iteration.
    const nextUrl = new URL(linkInfo.next.url)
    nextPathname = nextUrl.pathname
    nextUrl.searchParams.forEach((value, name) => (params[name] = value))
  }
}

// eslint-disable-next-line space-before-function-paren
const main = async () => {
  // Store stats of users in this object.
  const userStats = {}
  const fromDate =
    periodQuantity === 0 ? null : moment().subtract(periodQuantity, 'days')
  // eslint-disable-next-line camelcase
  const isPeriodValid = (created_at) =>
    periodQuantity === 0 ? true : moment(created_at).isAfter(fromDate)

  // This function will populate the user stats object from the comments we'll receive from the HTTP endpoint.
  const processComments = (comments) =>
    comments.forEach((comment) => {
      const {
        user: { login },
        // eslint-disable-next-line camelcase
        created_at,
      } = comment

      if (!isPeriodValid(created_at)) {
        return
      }

      if (userStats[login]) {
        userStats[login].comments++
      } else {
        userStats[login] = { comments: 1 }
      }
    })

  // This function will populate the user stats object from the commits we'll receive from the HTTP endpoint.
  const processCommits = (commits) =>
    commits.forEach((commitsInfo) => {
      const login = commitsInfo.author.login

      // Only add commits if there are comments for the user.
      // See Note 1 above.
      if (Object.prototype.hasOwnProperty.call(userStats, login)) {
        userStats[login].commits = commitsInfo.total
      }
    })

  console.log(
    `Fetching comments for past ${periodQuantity} days for "${repoPath}"...`,
  )

  // Process commit comments.
  await processAllPages(`/repos/${owner}/${repo}/comments`, processComments)

  // Process issue comments.
  await processAllPages(
    `/repos/${owner}/${repo}/issues/comments`,
    processComments,
  )

  // Process PR comments.
  await processAllPages(
    `/repos/${owner}/${repo}/pulls/comments`,
    processComments,
  )

  // Process users' commits.
  await processAllPages(
    `/repos/${owner}/${repo}/stats/contributors`,
    processCommits,
  )

  // Convert the stats object to array and sort it.
  const output = Object.entries(userStats).map(([key, value]) =>
    Object.assign(value, { login: key }),
  )
  output.sort((a, b) => (a.comments > b.comments ? -1 : 1))

  if (output.length) {
    const padAmount = String(output[0].comments).length

    output.forEach(({ comments, login, commits }) => {
      console.log(
        `${leftPad(String(comments), padAmount)} comments, ${login} (${
          commits || 'no'
        } commits)`,
      )
    })
  } else {
    console.log('No comments in this repository.')
  }
}

main()
