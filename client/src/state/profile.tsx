import { createContext } from "react";

export type Profile = {
  id: number;
  avatar: string;
  permission: boolean;
  name: string;
  /** 已绑定邮箱；未绑定为 null。 */
  email: string | null;
  /** 是否已设置密码，资料页据此决定是否要求填写当前密码。 */
  hasPassword: boolean;
}

export const ProfileContext = createContext<Profile | undefined | null>(undefined);
