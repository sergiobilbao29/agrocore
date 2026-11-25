# -*- coding: utf-8 -*-
"""Instructivo: Centros de costo (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Empleados-Compartidos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#1f2937"))
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=G900)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def tabla(data, anchos):
    rows = []
    for r_i, row in enumerate(data):
        rows.append([Paragraph(c, st_cellb if r_i==0 else st_cell) for c in row])
    t = Table(rows, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#cbd5e1")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Empleados compartidos (jornaleros del grupo)", st_title))
    E.append(Paragraph("Un mismo jornalero que trabaja en varias empresas: un solo legajo, labores desde cualquier empresa y una liquidación única", st_sub))
    E.append(Paragraph(
        "Si tenés <b>jornaleros</b> que hacen labores en <b>varias empresas</b> del grupo, no hace falta cargarlos ni liquidarlos por "
        "separado en cada una. Podés marcar al empleado como <b>compartido</b>: queda un <b>solo legajo</b> disponible en todas las "
        "empresas, le cargás las labores donde las hizo (el <b>costo queda en esa empresa</b>) y a fin de mes hacés una <b>liquidación "
        "única</b>. Es opcional y se activa empleado por empleado: los que no marques siguen igual que siempre.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; marcás el empleado como compartido &rarr; le cargás jornales desde cualquier "
                     "empresa &rarr; a fin de mes hacés una sola liquidación y la pagás desde la empresa que elijas.", G100, G600, G900))
    E.append(callout("<b>Aviso fiscal:</b> la liquidación única es una <b>vista de gestión</b> (cuánto le debo al jornalero y pagarle de "
                     "una). Para AFIP cada razón social puede necesitar su <b>propio recibo</b>: por eso el sistema muestra el "
                     "<b>desglose por empresa</b>, para que el contador arme lo que corresponda.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Marcar el empleado como compartido", st_h2))
    E.append(steps([
        "Entrá a <b>Empleados</b> y abrí (o creá) la ficha del jornalero.",
        "Tildá <b>&ldquo;Compartir con todo el grupo (jornalero que trabaja en varias empresas)&rdquo;</b> y guardá.",
        "Listo: el empleado queda disponible desde <b>todas las empresas</b> del grupo. En la nómina se identifica con el chip <b>Grupo</b>.",
    ]))
    E.append(callout("<b>Empresas aisladas:</b> una empresa marcada como <b>aislada</b> no ve ni usa los empleados compartidos del grupo "
                     "(respeta la misma regla que el resto de los recursos compartidos).", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar labores / jornales desde cualquier empresa", st_h2))
    E.append(steps([
        "Entrá a la empresa donde el jornalero trabajó ese día.",
        "Cargá la labor (en <b>Labores</b>) o el jornal/adelanto (en la <b>Planilla</b> del empleado): el empleado compartido aparece en la lista como cualquier otro.",
        "Cada movimiento <b>guarda la empresa donde se cargó</b>: ese es el costo real de esa empresa (se ve en su flujo de fondos y en centros de costo).",
        "Repetí en cada empresa según donde trabajó. No se duplica el empleado: es siempre el mismo legajo.",
    ]))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Liquidación única del mes", st_h2))
    E.append(steps([
        "En la ficha del empleado, en el mes a liquidar, tocá <b>&ldquo;Liquidación única (grupo)&rdquo;</b>.",
        "El sistema junta los movimientos del mes de <b>todas las empresas</b> y muestra una tabla con el <b>neto por empresa</b> y el <b>TOTAL a pagar</b>.",
        "Elegí la <b>empresa pagadora</b> (de donde sale el pago), el <b>medio</b> (efectivo y su caja, transferencia y el banco, o cheque propio) y confirmá.",
        "Queda una sola liquidación con el pago registrado y todos los movimientos del grupo marcados como liquidados. El <b>desglose por empresa</b> queda en las observaciones para el contador.",
    ]))
    E.append(callout("<b>Cómo se reparte:</b> el <b>costo</b> de cada jornal ya quedó en la empresa donde se hizo (por el movimiento). "
                     "El <b>pago</b> del neto total sale de la empresa pagadora que elegiste. Si en tu grupo manejan una caja común, esto "
                     "refleja bien la realidad; si no, usá el desglose por empresa para ordenar lo que cada una aporta.", G100, G600, G900))

    E.append(Paragraph("Anular / rehacer", st_h2))
    E.append(bullets([
        "Si te equivocaste, <b>anulá</b> la liquidación consolidada <b>desde la empresa pagadora</b> (es donde quedó el pago): se borra el egreso y los movimientos vuelven a quedar sin liquidar.",
        "Después volvés a hacer la <b>Liquidación única (grupo)</b> con los datos corregidos.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Tengo que crear el jornalero en cada empresa?",
         "No. Lo creás una sola vez y lo marcás como compartido; queda disponible en todas las empresas del grupo."),
        ("¿En qué empresa queda el costo de cada jornal?",
         "En la empresa donde cargaste la labor/jornal. Cada movimiento guarda su empresa, así que el costo se ve en el flujo de fondos y los centros de costo de esa empresa."),
        ("¿La liquidación única reemplaza al recibo de AFIP?",
         "No. Es una vista de gestión para saber cuánto pagarle y pagarlo de una. Para AFIP cada razón social puede necesitar su propio recibo; por eso se muestra el desglose por empresa."),
        ("¿Desde qué empresa se paga?",
         "Desde la que elijas al liquidar (empresa pagadora). De ahí sale el egreso en efectivo, transferencia o cheque por el neto total."),
        ("¿Qué pasa con las empresas aisladas?",
         "No participan: no ven ni liquidan al empleado compartido."),
        ("¿Puedo seguir liquidando normal a un empleado que no es compartido?",
         "Sí. Todo el circuito de los empleados no compartidos sigue exactamente igual que antes."),
        ("El jornalero cobra por día: ¿toma el sueldo base automático?",
         "En la liquidación única el neto sale de los movimientos cargados (jornales/labores del mes). Cargá los jornales como movimientos y el total se calcula sobre ellos."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
