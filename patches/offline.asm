; A permanent per-run seat mask, set only by synchronized membership events.
; R_OUT=2 retains stocks and excludes every rescue/revive/reward path.
offline_mask: db 0
offline_sense_ptr: dw 0x06c4,0x130e
hud_offline: db 'OFFLINE',0
offline_input_hook:
    call far [cs:offline_sense_ptr]
offline_apply:
    pushad
    cmp byte [cs:offline_mask],0
    je .done
    call resource_store
    test byte [cs:offline_mask],1
    jz .p2
    mov byte [cs:resources+R_OUT],2
    mov byte [0x4669],0
    mov byte [0x466a],1
    mov byte [0x4662],255
    mov word [0x42c8],0
    and word [0x3974],0x1000 ; shared native pause remains available
    mov byte [0x3976],0
.p2:
    test byte [cs:offline_mask],2
    jz .p3
    mov byte [cs:resources+16+R_OUT],2
    mov byte [cs:p2_flags+3],0
    mov byte [cs:p2_flags+4],1
    mov byte [cs:p2_motion+22],255
    mov word [cs:p2_laser],0
    mov word [cs:p2_input],0
    mov byte [cs:p2_focus],0
.p3:
    test byte [cs:offline_mask],4
    jz .done
    mov byte [cs:resources+32+R_OUT],2
    mov byte [cs:p3_flags+3],0
    mov byte [cs:p3_flags+4],1
    mov byte [cs:p3_motion+22],255
    mov word [cs:p3_laser],0
    mov word [cs:p3_input],0
    mov byte [cs:p3_focus],0
.done:
    popad
    ret
