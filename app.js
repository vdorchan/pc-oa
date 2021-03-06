#!/usr/bin/env node

const cheerio = require('cheerio')
const moment = require('moment')
const iconv = require('iconv-lite')
const got = require('got')
const chalk = require('chalk')
const fs = require('fs')
const path = require('path')
const homedir = require('os').homedir()
const readline = require('readline')

const styleTitle = title => {
  const len = (50 - title.length) / 2
  return chalk.green(`${'='.repeat(Math.floor(len))} ${title} ${'='.repeat(Math.ceil(len))}`)
}

const loading = msg => process.stdout.write(msg)

const clearLoading = msg => {
  readline.cursorTo(process.stdout, 0)
  readline.clearLine(process.stdout, 0)
  readline.cursorTo(process.stdout, 0)
  msg && console.log(msg)
}

const outputCompensatoryLeave = async (client, userId) => {
  let {
    body: listBody
  } = await client.get(`/kaoqin/listJiaBan.do?userId:=${userId}&endTime=2018-11-27+09%3A00&keXiuValidDate=${moment().format('YYYY-MM-DD%20HH:mm')}`, {
    encoding: null
  })

  const $ = cheerio.load(iconv.decode(listBody, 'gbk'))

  let totalTime = 0

  // const tableList = [
  //   ['开始加班', '结束时间', '截止时间', '总共可休', '还剩', '事由']
  // ]

  let output = ''

  $('.table tbody').find('tr').each((idx, el) => {
    const $td = $(el).find('td')
    const tdText = i => $td.eq(i).text()

    output += `
可休 ${chalk.cyan(tdText(5))} 截止到 ${chalk.red(tdText(3))} 前可用
从${tdText(1)} 加班到 ${tdText(2)}（${tdText(4)}）
事由：${chalk.gray(tdText(6))}
`
    // tableList.push([
    //   tdText(1),
    //   tdText(2),
    //   tdText(3),
    //   tdText(4),
    //   chalk.cyan(tdText(5)),
    //   tdText(6)
    // ])

    try {
      totalTime += parseFloat(tdText(5).match(/\S+h/g)[0])
    } catch (error) {}
  })

  clearLoading(`${styleTitle('调休')}\n
当前总共可调休 ${chalk.cyan(`${totalTime}(${Math.round(totalTime * 100 / 8) / 100})`)} 小时`)

  // const output = table(tableList)

  console.log(output)
}

const outputAnnualLeave = async (client, userId) => {
  const {
    body: {
      lastYearRemainNianJia,
      remain,
      realRemain
    }
  } = await client.post('/kaoqin/nianJia/getRemainNianJia.do', {
    json: true,
    form: true,
    body: {
      userId,
      dateStr: moment().format('YYYY-MM')
    }
  })

  clearLoading(`${styleTitle('年假')}\n
截止到当前，总共还剩 ${chalk.cyan(realRemain)} 天年假可休
去年 ${chalk.cyan(lastYearRemainNianJia)} 天 + 今年 ${chalk.cyan(remain)} 天
`)
}

const outputPunchRecord = async (client, userId) => {
  const { body } = await client.post('/kaoqin/card/listCard.do', {
    encoding: null,
    form: true,
    body: {
      userId,
      yearAndMonth: moment().format('YYYY-MM')
    }
  })

  const $ = cheerio.load(iconv.decode(body, 'gbk'))

  const $tr = $('.tableClass').find('.list').find('tr')
  const $th = $tr.find('th')
  const $td = $tr.find('td')

  clearLoading(`${styleTitle('出勤状况')}\n`)

  $th.each((i, elem) => {
    if (i >= 2) {
      console.log(`${$(elem).text().trim()}: ${chalk.cyan($td.eq(i).text().trim())}`)
    }
  })

  console.log(`\n${styleTitle('异常打卡记录')}`)

  $('.table').find('tr').each(function () {
    const $td = $(this).find('td')
    if ($td.eq(-3).text() !== '正常') {
      let hasLog = false
      $td.each(function () {
        const $bChecked = $(this).find('.sBlock-b-checked')
        const $eChecked = $(this).find('.sBlock-e-checked')
        const $cChecked = $(this).find('.sBlock-c-checked')

        if (!hasLog && ($bChecked.length || $eChecked.length || $cChecked.length)) {
          hasLog = true
          console.log(`\n异常（${$td.eq(0).text().replace(/\s+/g, '')}）:`)
        }

        if ($bChecked.length) {
          console.log(`打卡：${chalk.red($bChecked.find('em').text().replace(/\s+/g, ''))}`)
        }
        if ($cChecked.length) {
          console.log(`打卡：${chalk.red($cChecked.find('em').text().replace(/\s+/g, ''))}`)
        }
        if ($eChecked.length) {
          console.log(`打卡：${chalk.red($eChecked.find('em').text().replace(/\s+/g, ''))}`)
        }
      })
    }
  })
}

const ask = function (question, mask) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 0
  })

  return new Promise((resolve, reject) => {
    rl.question(question, answer => {
      resolve(answer)
      mask && rl.output.write('\n')
      rl.close()
    })

    rl._writeToOutput = str => rl.output.write(mask || str)
  })
}

;(async () => {
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(path.resolve(homedir, '.pcuserconf')))
    if (!user.username || !user.password) throw new Error()
  } catch (error) {
    user.username = await ask('your username? ')
    user.password = await ask('your password? ', '*')
    const pcuserconf = path.resolve(homedir, '.pcuserconf')

    fs.writeFileSync(pcuserconf, JSON.stringify(user, null, 2))
  }

  let client = got.extend({
    baseUrl: 'http://oa.pc.com.cn'
  })

  const formData = Object.assign({
    return: 'https://oa.pc.com.cn/login.do'
  }, user)

  loading('登录中...')

  let userId
  try {
    let loginUrl = ''
    try {
      await client.post('https://auth.pconline.com.cn/security-server/auth.do', {
        form: true,
        body: formData
      })
    } catch (error) {
      if (error.statusCode === 302 && error.headers.location) {
        loginUrl = error.headers.location
      }
    }

    let loginRes
    try {
      loginRes = await got.post(loginUrl)
    } catch (error) {
      if (error.statusCode === 302) {
        loginRes = error
      }
    }

    const cookie = loginRes.headers['set-cookie']

    const oaSession = cookie[0].match(/oa-session=[^;]+/g)[0].replace('oa-session=', '')
    const jSessionId = cookie[1].match(/JSESSIONID=[^;]+/g)[0].replace('JSESSIONID=', '')

    client = client.extend({
      headers: {
        cookie: `oa-session=${oaSession};JSESSIONID=${jSessionId};dwz_theme=silver;`
      }
    })

    const {
      body: userBody
    } = await client.get('/kaoqin/absence/new.do')

    let $ = cheerio.load(userBody)
    userId = $('.pageFormContent').find('input').eq(1).val()

    clearLoading('登录成功！')
  } catch (error) {
    return console.error('验证用户不成功，请检查账号密码')
  }

  loading('正在查询调休...')
  await outputCompensatoryLeave(client, userId)

  loading('正在查询年假...')
  await outputAnnualLeave(client, userId)

  loading('正在查询打卡记录...')
  await outputPunchRecord(client)
})()
