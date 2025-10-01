const Poll = require("../models/pollModel");

exports.createPoll = async (pollData) => {
  const newPoll = new Poll(pollData);
  await newPoll.save();
  return newPoll;
};

exports.voteOnOption = async (pollId, optionText) => {
  try {
    await Poll.findOneAndUpdate(
      { _id: pollId, "options.text": optionText },
      { $inc: { "options.$.votes": 1 } },
      { new: true }
    );
  } catch (error) {
    console.error("Error registering vote:", error);
  }
};

exports.getPolls = async (req, res) => {
  const { teacherUsername } = req.params;
  const data = await Poll.find({ teacherUsername });
  res.status(200).json({ data });
};
