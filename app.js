const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (err) {
    console.log(`DB ERROR:${err.message}`);
  }
};

initializeDbAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "ravisabbi", async (error, user) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = user.username;

        next();
      }
    });
  }
};
const convertTweetDbObjToResponseObj = (dbObj) => {
  return {
    username: dbObj.username,
    tweet: dbObj.tweet,
    dateTime: dbObj.date_time,
  };
};

//REGISTER USER API
app.post("/register/", async (request, response) => {
  let { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO
                                       user(name,username,password,gender)
                                       VALUES('${name}','${username}','${hashedPassword}','${gender}');`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  }
});

//LOGIN USER API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      console.log(dbUser);
      const payLoad = { username: username };
      const jwtToken = jwt.sign(payLoad, "ravisabbi");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//LATEST TWEETS OF USER
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const getLatestTweetsOfUser = `SELECT tweet.tweet_id,
                                        tweet.user_id,
                                        user.username,
                                        tweet.tweet,
                                        tweet.date_time
                                        FROM tweet INNER JOIN  follower ON tweet.user_id = follower.following_user_id
                                        INNER JOIN user ON follower.following_user_id = user.user_id 
                                        WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
                                        ORDER BY tweet.date_time DESC
                                        LIMIT 4;`;

  const tweets = await db.all(getLatestTweetsOfUser);
  const result = tweets.map((eachTweet) =>
    convertTweetDbObjToResponseObj(eachTweet)
  );
  response.send(result);
});

//USER FOLLOWING PEOPLE API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const getPeopleFollowedByUserQuery = `SELECT user.name
                                                 FROM 
                                                 user INNER JOIN follower ON
                                                  user.user_id = follower.following_user_id
                                                  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username ='${request.username}');`;
  const peopleNames = await db.all(getPeopleFollowedByUserQuery);
  response.send(peopleNames);
});

// USER FOLLOWERS API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const getUserFollowersQuery = `
select
user.name
from
follower
left join user on follower.follower_user_id = user.user_id
where follower.following_user_id = (select user_id from user where username = "${request.username}");`;
  const followers = await db.all(getUserFollowersQuery);
  response.send(followers);
});

// MIDDLEWARE FUNCTION TO CHECK USER FOLLOWS AND FOLLOWER FOLLOWS

const checkFollows = async (request, response, next) => {
  let isFollows;
  const { tweetId } = request.params;
  const checkIsFollowsQuery = `SELECT * FROM follower WHERE 
    follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
    AND following_user_id = (SELECT user.user_id FROM user NATURAL JOIN  tweet WHERE tweet_id = ${tweetId});`;
  isFollows = await db.get(checkIsFollowsQuery);
  if (isFollows === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    console.log("He is follows");
    next();
  }
};

//GET TWEET API
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  checkFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(
      `SELECT tweet,date_time FROM tweet WHERE tweet_id = ${tweetId};`
    );
    const { likes } = await db.get(
      `SELECT COUNT(*) AS likes FROM like WHERE tweet_id = ${tweetId};`
    );
    const { replies } = await db.get(
      `SELECT COUNT(*) AS replies FROM reply WHERE tweet_id = ${tweetId}`
    );
    response.send({
      tweet: tweet,
      likes: likes,
      replies: replies,
      dateTime: date_time,
    });
  }
);

// GET LIKED  ALL USERNAMES IF USER FOLLOWS API
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  checkFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getAllLikedUserNames = `SELECT user.username FROM user NATURAL JOIN like WHERE tweet_id = ${tweetId};`;
    const usernames = await db.all(getAllLikedUserNames);
    const responseArray = usernames.map((user) => user.username);
    response.send({ likes: responseArray });
  }
);

//GET ALL REPLIES OF TWEET

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  checkFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getAllRepliesQuery = `SELECT user.name,reply.reply FROM user NATURAL JOIN reply WHERE tweet_id = ${tweetId};`;
    const replies = await db.all(getAllRepliesQuery);
    const repliesArray = replies.map((eachReply) => ({
      name: eachReply.name,
      reply: eachReply.reply,
    }));
    response.send({ replies: repliesArray });
  }
);

//GET ALL TWEETS OF USER API
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const myTweets = await db.all(`
select
tweet.tweet,
count(distinct like.like_id) as likes,
count(distinct reply.reply_id) as replies,
tweet.date_time
from
tweet
left join like on tweet.tweet_id = like.tweet_id
left join reply on tweet.tweet_id = reply.tweet_id
where tweet.user_id = (select user_id from user where username = "${request.username}")
group by tweet.tweet_id;
`);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

// POST A TWEET
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `SELECT user_id FROM user WHERE username = '${request.username}';`
  );
  const postTweetQuery = `INSERT INTO tweet (tweet,user_id)
                                   VALUES('${tweet}',${user_id});`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

// DELETE TWEET API

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(`
select
tweet_id, user_id
from
tweet
where tweet_id = ${tweetId}
and user_id = (select user_id from user where username = "${request.username}");
`);
    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
DELETE FROM tweet
WHERE tweet_id = ${tweetId}
`);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
