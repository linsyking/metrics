//Setup
export default async function ({ login, q, imports, data, computed, rest, graphql, queries, account }, { enabled = false, extras = false } = {}) {
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q.vndb) || (!imports.metadata.plugins.vndb.enabled(enabled, { extras }))) {
      return null
    }
    let config = imports.metadata.plugins.vndb.inputs({ data, account, q })
    let mydata = {
      sections: config['sections'],
      user: config['user'],
      finished_games_limit: config['finished.games.limit'],
      playing_games_limit: config['playing.games.limit'],
      favourite_games: config['favourite.games'],
      tagmax: config['tag.limit']
    }
    return await deal(imports, mydata)
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}


async function getUserData(imports, uid) {
  const res = await imports.axios.get(
    'https://api.vndb.org/kana/user?q=' +
    uid +
    '&fields=lengthvotes_sum'
  )
  const total_time = res.data[uid]['lengthvotes_sum']
  const username = res.data[uid]['username']
  return { total_time, username }
}


function getTopTags(tags, maxtag) {
  // Sort the tags by rating and return the top 3
  tags.sort((a, b) => {
    return b.rating - a.rating
  })
  let taglist = []
  for (let i = 0; i < maxtag; i++) {
    taglist.push(tags[i].name)
  }
  return taglist
}

async function getRecentlyFinishedVnList(imports, uid, max, maxtag) {
  const res = await imports.axios.get("https://vndb.org/" + uid + "/ulist?s=3q8w")
  const re = new RegExp("<td class=\"tc_vote\">([^ ]*?)</td>.*?<td class=\"tc_title\"><a href=\"/(.*?)\".*?title=\"(.*?)\">(.*?)</a>.*?<td class=\"tc_started\">(.*?)</td>.*?<td class=\"tc_finished\">(.*?)</td>.*?</td>", "g")
  let match = re.exec(res.data)
  let finished_vns = []
  while (match != null) {
    finished_vns.push({
      "vote": match[1],
      "id": match[2],
      "altname": match[3],
      "name": match[4],
      "start": match[5],
      "finish": match[6]
    })
    match = re.exec(res.data)
  }
  finished_vns = finished_vns.slice(0, max)
  await addExtraInfo(imports, finished_vns, maxtag)
  let matchs = /Playing.*?\((.+?)\).*?Finished.*?\((.+?)\)/
  const re2 = new RegExp(matchs)
  match = re2.exec(res.data)
  let playing_num = match[1]
  let finished_num = match[2]
  return { finished_vns, playing_num, finished_num }
}

function toHoursAndMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
}


async function getRecentlyPlayingVnList(imports, uid, max, maxtag) {
  const res = await imports.axios.get("https://vndb.org/" + uid + "/ulist?l=1&s=3q7w")
  const re = new RegExp("<td class=\"tc_vote\">([^ ]*?)</td>.*?<td class=\"tc_title\"><a href=\"/(.*?)\".*?title=\"(.*?)\">(.*?)</a>.*?<td class=\"tc_started\">(.*?)</td>.*?<td class=\"tc_finished\">(.*?)</td>.*?</td>", "g")
  let match = re.exec(res.data)
  let vns = []
  while (match != null) {
    vns.push({
      "vote": match[1],
      "id": match[2],
      "altname": match[3],
      "name": match[4],
      "start": match[5],
      "finish": match[6]
    })
    match = re.exec(res.data)
  }
  vns = vns.slice(0, max)
  await addExtraInfo(imports, vns, maxtag)
  return vns
}

async function addExtraInfo(imports, vns, maxtag) {
  if (vns.length == 0) {
    return
  }
  let ft = ["or"]
  for (let i = 0; i < vns.length; i++) {
    ft.push(["id", "=", vns[i].id])
  }
  const vndata = {
    "filters": ft,
    "fields": "image.url, tags.name, tags.rating"
  }
  const res = await imports.axios.post("https://api.vndb.org/kana/vn", vndata)

  for (let i = 0; i < vns.length; i++) {
    for (let j = 0; j < res.data.results.length; j++) {
      const dataRes = res.data.results[j]
      if (vns[i].id == dataRes.id) {
        vns[i].image = await urlToImage(imports, dataRes.image.url)
        vns[i].tags = getTopTags(dataRes.tags, maxtag)
        break
      }
    }
  }
}

async function urlToImage(imports, url) {
  return await imports.imgb64(url, { width: 64, height: 64 })
}

async function getFavouriteVns(imports, vns, uid, maxtag) {
  if (vns.length == 0) {
    return []
  }
  let ft = ["or"]
  for (let i = 0; i < vns.length; i++) {
    ft.push(["id", "=", vns[i]])
  }
  const vndata = {
    "filters": ft,
    "fields": "alttitle, title, image.url, tags.name, tags.rating"
  }
  const res = await imports.axios.post("https://api.vndb.org/kana/vn", vndata)
  let result = []
  for (let i = 0; i < vns.length; i++) {
    const dataRes = res.data.results[i]
    result.push({
      "id": dataRes.id,
      "altname": dataRes.alttitle ? dataRes.alttitle : dataRes.title,
      "name": dataRes.title,
      "image": await urlToImage(imports, dataRes.image.url),
      "tags": getTopTags(dataRes.tags, maxtag)
    })
  }
  await getVNUserInfo(imports, result, uid)
  return result
}

async function deal(imports, data) {
  let result = {}
  try {
    const maxtag = data.tagmax
    const uid = data.user
    if (uid == '') {
      return
    }
    const { total_time, username } = await getUserData(imports, uid)
    const { finished_vns, playing_num, finished_num } = await getRecentlyFinishedVnList(imports, uid, data.finished_games_limit, maxtag)
    result.player = {
      username: username,
      total_time: toHoursAndMinutes(total_time),
      finished_num: finished_num,
      playing_num: playing_num
    }
    const playing_vns = await getRecentlyPlayingVnList(imports, uid, data.playing_games_limit, maxtag)
    const favourite_vns = await getFavouriteVns(imports, data.favourite_games, uid, maxtag)
    result.finished_vns = finished_vns
    result.playing_vns = playing_vns
    result.favourite_vns = favourite_vns
    result.sections = data.sections
    return result
  } catch (err) {
    console.error(err)
  }
}

async function getVNUserInfo(imports, vns, uid) {
  if (vns.length == 0) {
    return
  }
  let ft = ["or"]
  for (let i = 0; i < vns.length; i++) {
    ft.push(["id", "=", vns[i].id])
  }
  const vndata = {
    "user": uid,
    "filters": ft,
    "fields": "vote, started, finished, notes",
    "results": 100
  }
  const res = await imports.axios.post("https://api.vndb.org/kana/ulist", vndata)
  const results = res.data.results
  for (let i = 0; i < vns.length; ++i) {
    for (let j = 0; j < results.length; ++j) {
      if (vns[i].id == results[j].id) {
        vns[i].notes = results[j].notes
        vns[i].start = results[j].started ? results[j].started : ''
        vns[i].finish = results[j].finished ? results[j].finished : ''
        vns[i].vote = results[j].vote ? (results[j].vote / 10).toString() : '-'
        break
      }
    }
  }
}
