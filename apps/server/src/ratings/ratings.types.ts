export interface GameRatingDoc {
  _id: string; // randomUUID()
  userId: string;
  gameId: string;
  roomId: string;
  stars: number; // 1-5, integer
  createdAt: Date;
}
