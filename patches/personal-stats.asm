; All seats have identical authoritative state on all clients. The browser
; selects a seat only when compositing the final HUD, outside guest memory.
; 20 bytes: score:u32, high:u32, point:u8, dream_count:u8, dream:u16,
; graze:u16, total_point:u16, max_point:u16, extends:u8, reserved:u8.
personal_stats: times 3*20 db 0
personal_bonus: db 0          ; 1 = stage, 2 = all-clear, then actual award u32[3]
    times 3 dd 0
stats_ready: db 0
hit_weights: times 3 dw 0
hit_owner: db 0
extend_thresholds: dd 3000000,8000000,15000000,22000000,30000000

stats_index:
    movzx si,byte [cs:active_p2]
    imul si,20
    add si,personal_stats
    ret
stats_store:
    pushad
    call stats_index
    mov al,[0x466b]
    mov ah,[0x4676]
    mov [cs:si+8],ax
    mov ax,[0xbccc]
    mov [cs:si+10],ax
    mov ax,[0xbcbc]
    mov [cs:si+12],ax
    mov eax,[0x239c]
    mov [cs:si+14],eax
    popad
    ret
stats_load:
    pushad
    call stats_index
    mov ax,[cs:si+8]
    mov [0x466b],al
    mov [0x4676],ah
    mov ax,[cs:si+10]
    mov [0xbccc],ax
    mov ax,[cs:si+12]
    mov [0xbcbc],ax
    mov eax,[cs:si+14]
    mov [0x239c],eax
    popad
    ret
stats_restart:
    pushad
    call stats_store
    mov al,[0x4349]
    mov [cs:score_continues],al
    xor bx,bx
.slot:
    imul si,bx,20
    mov dword [cs:personal_stats+si],0
    mov byte [cs:personal_stats+si+18],0
    mov byte [cs:personal_stats+si+9],0
    mov word [cs:personal_stats+si+10],0
    inc bx
    cmp bx,3
    jb .slot
    call stats_load
    popad
    ret
stats_stage_reset:
    pushad
    mov byte [cs:personal_bonus],0
    ; Preserve score and lifetime item totals; reset stage-specific fields.
    mov si,personal_stats
    mov cx,3
.slot:
    mov dword [cs:si+8],0
    mov word [cs:si+12],0
    add si,20
    loop .slot
    cmp byte [cs:stats_ready],0
    jne .load
    xor eax,eax
    mov si,0x4358              ; original 8-digit high score, MS digit
    mov cx,8
.high:
    imul eax,10
    movzx edx,byte [si]
    add eax,edx
    dec si
    loop .high
    mov [cs:personal_stats+4],eax
    mov [cs:personal_stats+24],eax
    mov [cs:personal_stats+44],eax
    mov byte [cs:stats_ready],1
.load:
    call stats_load
    popad
    ret

; Original delta units are ten displayed points. *15 / *22 therefore
; represents *1.5 / *2.2 exactly, with no discarded fractional points.
stats_add:
    pushad
    mov ecx,15
    cmp byte [cs:player_count],3
    jne .scale
    mov ecx,22
.scale:
    mul ecx
    test edx,edx
    jz .credit
    mov eax,99999999
.credit:
    call stats_credit
    popad
    ret
; BX = logical slot, EAX = actual displayed points. Preserve all registers.
stats_credit:
    pushad
    mov si,bx
    shl si,4
    cmp byte [cs:resources+si+R_OUT],0
    jne .done
    imul si,bx,20
    add eax,[cs:personal_stats+si]
    jc .cap
    cmp eax,99999999
    jbe .store
.cap:
    mov eax,99999999
.store:
    mov [cs:personal_stats+si],eax
    cmp eax,[cs:personal_stats+si+4]
    jbe .done
    mov [cs:personal_stats+si+4],eax
.done:
    popad
    ret
stats_active_add:
    push bx
    movzx bx,byte [cs:active_p2]
    call stats_add
    pop bx
    retf
stats_kill_add:
    push bx
    movzx bx,byte [cs:hit_owner]
    call stats_add
    pop bx
    retf
stats_bit_add:
    push eax
    mov eax,5120
    push cs
    call stats_kill_add
    pop eax
    retf
stats_cross_add:
    push eax
    mov eax,3000
    push cs
    call stats_kill_add
    pop eax
    retf

; Unowned world bonuses go to the surviving team in equal actual-point
; shares. Distribute the remainder without discarding any awarded points.
stats_world_add:
    pushad
    imul eax,15
    cmp byte [cs:player_count],3
    jne .scaled
    ; Recover raw units without rounding: EAX was multiplied by exactly 15.
    xor edx,edx
    mov ecx,15
    div ecx
    imul eax,22
.scaled:
    mov edi,eax
    xor ecx,ecx
    xor bx,bx
.count:
    mov si,bx
    shl si,4
    cmp byte [cs:resources+si+R_OUT],0
    jne .count_next
    inc ecx
.count_next:
    inc bx
    cmp bl,[cs:player_count]
    jb .count
    jecxz .done
    mov eax,edi
    xor edx,edx
    div ecx
    mov edi,eax
    mov ebp,edx
    xor bx,bx
.award:
    mov si,bx
    shl si,4
    cmp byte [cs:resources+si+R_OUT],0
    jne .next
    mov eax,edi
    test ebp,ebp
    jz .give
    inc eax
    dec ebp
.give:
    call stats_credit
.next:
    inc bx
    cmp bl,[cs:player_count]
    jb .award
.done:
    popad
    retf
stats_clear_big:
    push eax
    mov eax,100
    push cs
    call stats_clear_add
    pop eax
    retf
stats_clear_small:
    push eax
    mov eax,10
    push cs
    call stats_clear_add
    pop eax
    retf
stats_clear_add:
    cmp byte [0x4368],0
    je stats_world_add
    push bx
    movzx bx,byte [cs:bomb_owner]
    call stats_add
    pop bx
    retf

stats_damage_reset:
    mov dword [cs:hit_weights],0
    mov word [cs:hit_weights+4],0
    xor di,di                 ; displaced original instructions
    mov byte [bp-15],0
    ret
stats_shot_hit:
    pushad
    mov cx,ax
    mov bx,18
    mov ax,si
    sub ax,0xb55e
    xor dx,dx
    div bx
    mov bx,ax
    movzx bx,byte [cs:shot_owners+bx] ; already slot * 2
    ; Recover the exact damage after the original simultaneous-hit divisor.
    add [cs:hit_weights+bx],cx
    popad
    add di,ax
    inc byte [0x4640]
    ret
stats_bomb_hit:
    push bx
    movzx bx,byte [cs:bomb_owner]
    shl bx,1
    add word [cs:hit_weights+bx],5
    pop bx
    add di,5
    cmp byte [0x1b5c],0
    ret
stats_laser_hit:
    add word [cs:hit_weights],3
    add di,3
    inc byte [0x4640]
    ret
stats_damage_finish:
    pushad
    xor ecx,ecx
    xor bx,bx
    xor dx,dx
    mov byte [cs:hit_owner],0
.sum:
    movzx eax,word [cs:hit_weights+bx]
    add ecx,eax
    cmp ax,dx
    jbe .sum_next
    mov dx,ax
    mov ax,bx
    shr ax,1
    mov [cs:hit_owner],al
.sum_next:
    add bx,2
    cmp bx,6
    jb .sum
    jecxz .done
    movzx edi,di
    xor esi,esi
    xor ebp,ebp
    xor bx,bx
.share:
    push bx
    shl bx,1
    movzx eax,word [cs:hit_weights+bx]
    pop bx
    add ebp,eax
    mov eax,ebp
    mul edi
    div ecx
    sub eax,esi
    add esi,eax
    call stats_add
    inc bx
    cmp bl,[cs:player_count]
    jb .share
.done:
    popad
    retf

; Native BCD is mirrored from P1 solely for the original HUD/end-game code.
; Each client's visible HUD is read from its own authoritative bank.
stats_frame:
    pushad
    push es
    call resource_store
    xor bx,bx
.slot:
    imul si,bx,20
    movzx di,byte [cs:personal_stats+si+18]
    cmp di,5
    jae .next
    shl di,2
    mov eax,[cs:personal_stats+si]
    cmp eax,[cs:extend_thresholds+di]
    jb .next
    mov di,bx
    shl di,4
    cmp byte [cs:resources+di+R_OUT],0
    jne .next
    inc byte [cs:personal_stats+si+18]
    cmp byte [cs:resources+di+R_LIVES],100
    jae .slot
    inc byte [cs:resources+di+R_LIVES]
    mov byte [0x469b],1
    mov word [0x469e],ORIGINAL(0x112d8)
    push bx
    push word 7
    call far [cs:sound_pointer]
    pop bx
    jmp .slot
.next:
    inc bx
    cmp bl,[cs:player_count]
    jb .slot
    call resource_load
    mov eax,[cs:personal_stats]
    mov dl,[0x4349]
    mov [cs:score_continues],dl
    mov di,0x4349
    call .bcd
    mov dl,[cs:score_continues]
    mov [0x4349],dl          ; native routing uses this byte as continue count
    mov eax,[cs:personal_stats+4]
    mov di,0x4351
    call .bcd
    call ORIGINAL(0x11692)
    ; Retain correct P1 counters underneath the presentation-only layer.
    push cs
    call ORIGINAL(0xf064)
    push cs
    call ORIGINAL(0xf07a)
    push cs
    call ORIGINAL(0xf091)
    pop es
    popad
    ret
.bcd:
    mov cx,8
    mov ebx,10
.digit:
    xor edx,edx
    div ebx
    mov [di],dl
    inc di
    loop .digit
    ret

stats_stage_bonus:
    pushad
    xor bp,bp
    jmp stats_bonus_common
stats_allclear_bonus:
    pushad
    mov bp,1
stats_bonus_common:
    call resource_store
    xor bx,bx
.slot:
    imul si,bx,20
    mov di,bx
    shl di,4
    test bp,bp
    jz .stage
    mov byte [cs:personal_stats+si+18],10 ; no all-clear extends, as original
    mov eax,1000
    movzx edx,byte [cs:resources+di+R_LIVES]
    test edx,edx
    jz .base
    dec edx
    imul edx,1000
    cmp byte [0x4348],4
    jne .lives
    imul edx,3
.lives:
    add eax,edx
    jmp .base
.stage:
    movzx eax,byte [0x5394]
    inc eax
    imul eax,100
.base:
    movzx edx,byte [cs:resources+di+R_POWER]
    imul edx,5
    add eax,edx
    movzx edx,word [cs:personal_stats+si+10]
    add eax,edx
    movzx edx,word [cs:personal_stats+si+12]
    imul edx,5
    add eax,edx
    movzx edx,byte [cs:personal_stats+si+8]
    imul eax,edx
    cmp byte [0x53df],0
    jne .stock
    xor eax,eax
.stock:
    movzx ecx,byte [cs:run_config+2]
    cmp ecx,4
    jb .continues
    cmp ecx,6
    ja .continues
    imul ecx,-2
    add ecx,15               ; initial 4/5/6 lives: 0.7/0.5/0.3
    call .ratio
.continues:
    movzx ecx,byte [cs:score_continues]
    test ecx,ecx
    jz .rank
    cmp ecx,3
    ja .rank
    imul ecx,-2
    add ecx,10
    call .ratio
.rank:
    movzx ecx,byte [0x4348]
    cmp ecx,4
    jae .give
    shl ecx,1
    add ecx,8
    cmp ecx,8
    jne .rank_ratio
    mov ecx,5
.rank_ratio:
    call .ratio
.give:
    mov edx,[cs:personal_stats+si]
    call stats_add
    mov ecx,[cs:personal_stats+si]
    sub ecx,edx
    mov di,bx
    shl di,2
    mov [cs:personal_bonus+di+1],ecx
    inc bx
    cmp bl,[cs:player_count]
    jb .slot
    mov ax,bp
    inc ax
    mov [cs:personal_bonus],al
    popad
    retf
.ratio:
    mul ecx
    mov ecx,10
    div ecx
    ret
score_continues: db 0
