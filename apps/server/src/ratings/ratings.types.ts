export interface GameRatingDoc {
  _id: string; // randomUUID()
  userId: string;
  gameId: string;
  roomId: string;
  stars: number; // 1-5, integer
  text?: string; // optional free-text feedback, RATING_TEXT_MAX_LEN chars max
  createdAt: Date;
}
