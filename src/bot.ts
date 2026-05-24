import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { Octokit } from 'octokit'
import extract from 'extract-zip'
const express = require('express')

import { version } from '../package.json'

type TOptions = {
  secret: string
  pat: string
  tempdir: string
}

type TMetrics = {}

type TState = {
  gh: Octokit
}

export class Bot {
  options: TOptions
  metrics: TMetrics = {}
  state = {} as TState
  logger = console

  constructor(options?: Partial<TOptions>) {
    this.options = {
      secret: process.env.WEBHOOK_SECRET || process.env.SECRET || '',
      pat: process.env.GITHUB_TOKEN || process.env.GH_PAT || '',
      tempdir: './tmp',
      ...options,
    }
  }

  async init(): Promise<void> {
    this.state.gh = new Octokit({
      auth: this.options.pat,
    })

    // Create the temporary directory if it doesn't exist.
    if (!fs.existsSync(this.options.tempdir)) {
      fs.mkdirSync(this.options.tempdir)
    }
  }

  async routes(router: any): Promise<void> {
    router.post('/webhook', async (req: any, res: any) => {
      const id = crypto.randomUUID()
      try {
        // We'll need this later
        const owner = 'ethereum-optimism'
        const repo = 'ethereum-optimism.github.io'

        // Compute the HMAC of the request body
        const sig = Buffer.from(req.get('X-Hub-Signature-256') || '', 'utf8')
        const hmac = crypto.createHmac('sha256', this.options.secret)
        const digest = Buffer.from(
          `sha256=${hmac.update(req.rawBody).digest('hex')}`,
          'utf8'
        )

        // Check that the HMAC is valid
        if (sig.length !== digest.length || !crypto.timingSafeEqual(digest, sig)) {
          return res
            .status(200)
            .json({ ok: false, message: 'invalid signature on workflow' })
        }

        // Make sure we're only looking at "Validate PR" workflows
        if (req.body.workflow.name !== 'Validate PR') {
          return res
            .status(200)
            .json({ ok: false, message: 'incorrect workflow' })
        }

        const artifactQueryResponse = await this.state.gh.request(
          'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
          {
            owner,
            repo,
            run_id: req.body.workflow_run.id,
          }
        )

        if (artifactQueryResponse.data.total_count !== 1) {
          return res
            .status(200)
            .json({ ok: false, message: 'incorrect number of artifacts' })
        }

        const artifact = artifactQueryResponse.data.artifacts[0]
        if (artifact.name !== 'logs-artifact') {
          return res
            .status(200)
            .json({ ok: false, message: 'incorrect artifact name' })
        }

        const artifactDownloadResponse = await this.state.gh.request(
          'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
          {
            owner,
            repo,
            artifact_id: artifact.id,
            archive_format: 'zip',
          }
        )

        const tempdir = path.resolve(this.options.tempdir, id)
        if (!fs.existsSync(tempdir)) {
          fs.mkdirSync(tempdir)
        }

        const temploc = path.resolve(tempdir, `${artifact.id}.zip`)
        const tempout = path.resolve(tempdir, `${artifact.id}-out`)

        fs.writeFileSync(
          temploc,
          Buffer.from(
            new Uint8Array(artifactDownloadResponse.data as ArrayBuffer)
          )
        )

        await extract(temploc, {
          dir: path.resolve(tempout),
        })

        const pr = fs.readFileSync(path.resolve(tempout, 'pr.txt'), 'utf8')
        const err = fs.readFileSync(path.resolve(tempout, 'err.txt'), 'utf8')
        const std = fs.readFileSync(path.resolve(tempout, 'std.txt'), 'utf8')

        if (err.length > 0) {
          await this.state.gh.request(
            'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
            {
              owner,
              repo,
              issue_number: parseInt(pr, 10),
              body: `Got some errors while validating this PR. You will need to fix these errors before this PR can be reviewed.\n\`\`\`\n${err}\`\`\``,
            }
          )

          return res
            .status(200)
            .json({ ok: true, message: 'ok with error comment on PR' })
        }

        const warns = std.split('\n').filter((line) => {
          return line.startsWith('warning')
        })

        if (warns.length > 0) {
          await this.state.gh.request(
            'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
            {
              owner,
              repo,
              issue_number: parseInt(pr, 10),
              body: `Got some warnings while validating this PR. This is usually OK but this PR will require manual review if you are unable to resolve these warnings.\n\`\`\`\n${warns.join(
                '\n'
              )}\n\`\`\``,
            }
          )

          await this.state.gh.request(
            'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
            {
              owner,
              repo,
              issue_number: parseInt(pr, 10),
              labels: ['requires-manual-review'],
            }
          )

          return res
            .status(200)
            .json({ ok: true, message: 'ok with warning comment on PR' })
        }

        // Can safely remove requires-manual-review if we got here without warnings! Sometimes the
        // label will be on the PR because a previous iteration of the workflow had warnings but the
        // warnings were cleared up.
        await this.state.gh.request(
          'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
          {
            owner,
            repo,
            issue_number: parseInt(pr, 10),
            name: 'requires-manual-review',
          }
        )

        return res.status(200).json({ ok: true, message: 'noice!' })
      } catch (err) {
        this.logger.error(err)
        return res.status(500).json({ ok: false, message: 'unexpected error' })
      } finally {
        // Always clean up the tempdir.
        const tempdir = path.resolve(this.options.tempdir, id)
        if (fs.existsSync(tempdir)) {
          fs.rmdirSync(tempdir, { recursive: true })
        }
      }
    })
  }

  async main(): Promise<void> {
    // nothing to do here
  }

  async run(): Promise<void> {
    await this.init()
    const app = express()
    app.use(
      express.json({
        verify: (req: any, _res: any, buf: Buffer) => {
          req.rawBody = buf
        },
      })
    )
    await this.routes(app)
    await this.main()
    const port = Number(process.env.PORT || 7300)
    app.listen(port, () => {
      this.logger.log(`token-list-bot ${version} listening on ${port}`)
    })
  }
}

if (require.main === module) {
  const bot = new Bot()
  bot.run()
}
