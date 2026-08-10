import { createNet } from '../../shared/net.js';
import { GAME_SLUG } from './config.js';

export const {
  createRoom, joinRoom, fetchRoom, fetchMoves, fetchMyRooms, updateRoomStatus,
  finishRoom, RoomConnection, triggerPush, seatName, userSeat, seatLeft, markPlayerLeft, supabase,
} = createNet(GAME_SLUG);
