import { Modal } from "@rin/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ButtonWithLoading } from "./button";

export type Confirm = {
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
}

export type Alert = {
    message: string;
    onConfirm: () => void;
}

export type ShowAlertType = (msg: string, onConfirm?: () => (Promise<void> | void)) => void;

export function useAlert() {
    const [alert, setAlert] = useState<Alert | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const close = () => {
        alert?.onConfirm()
        setIsOpen(false)
        setAlert(null)
    }
    const showAlert = (alert: string, onConfirm?: () => void) => {
        setAlert({
            message: alert,
            onConfirm: onConfirm ?? (() => { })
        })
        setIsOpen(true)
    }
    const { t } = useTranslation()
    // 返回现成的 Modal 元素，而不是在每次渲染时新建一个组件类型。
    // 新建组件类型会让 React 把旧弹窗整体卸载，react-modal 来不及在关闭动画后移除
    // body 上的 ReactModal__Body--open 类，导致设置页保存后滚动被一直锁住。
    const alertUI = (
        <Modal
            isOpen={isOpen}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
            onRequestClose={close}
            contentLabel={t("alert")}
            size="sm"
            panelClassName="p-6"
        >
            <div className="flex w-full flex-col items-start space-y-4">
                <h1 className="text-xl font-bold tracking-[-0.02em] t-primary">
                    {t("alert")}
                </h1>
                <p className="text-base t-primary">
                    {alert?.message}
                </p>
                <div className="w-full flex flex-row items-center justify-center space-x-2 mt-4">
                    <Button onClick={close} title={t('confirm')} />
                </div>
            </div>
        </Modal>
    )
    return { showAlert, close, alertUI }
}

export function useConfirm() {
    const [confirm, setConfirm] = useState<Confirm | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false);
    const close = () => {
        setConfirm(null)
        setIsOpen(false)
    }
    const showConfirm = (title: string, message: string, onConfirm?: () => Promise<void> | void) => {
        setConfirm({
            title,
            message,
            onConfirm: onConfirm ?? (() => { })
        })
        setIsOpen(true)
    }
    const { t } = useTranslation()
    // 与 alertUI 同理：保持 Modal 实例稳定，关闭后才能正常解除 body 滚动锁。
    const confirmUI = (
        <Modal
            isOpen={isOpen}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
            onRequestClose={close}
            contentLabel={confirm?.title ?? t("confirm")}
            size="sm"
            panelClassName="p-6"
        >
            <div className="flex w-full flex-col items-start space-y-4">
                <h1 className="text-xl font-bold tracking-[-0.02em] t-primary">
                    {confirm?.title}
                </h1>
                <p className="text-base t-primary">
                    {confirm?.message}
                </p>
                <div className="w-full flex flex-row items-center justify-center space-x-2 mt-4">
                    <ButtonWithLoading
                        loading={loading}
                        onClick={async () => {
                            setLoading(true);
                            await confirm?.onConfirm();
                            setLoading(false);
                            setIsOpen(false);
                        }}
                        title={t('confirm')} />
                    <Button secondary onClick={close} title={t('cancel')} />
                </div>
            </div>
        </Modal>
    )
    return { showConfirm, close, confirmUI }
}
