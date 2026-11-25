# -*- coding: utf-8 -*-
"""Instructivo: Tarjetas de credito — carga, gastos, pagar con tarjeta, resumen y pago (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Tarjetas-Credito.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

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
    E.append(Paragraph("Tarjetas de crédito", st_title))
    E.append(Paragraph("Cargar la tarjeta, registrar los gastos, pagar con ella, e importar y pagar el resumen del banco", st_sub))
    E.append(Paragraph(
        "La <b>tarjeta de crédito</b> en AgroCore sirve para dos cosas: <b>(1)</b> es un <b>medio de pago</b> más "
        "(podés pagar compras, ventas, sueldos, cuotas, viajes, etc. con tarjeta) y <b>(2)</b> es una <b>cuenta propia</b> "
        "donde se van sumando los gastos que hacés con ella (su <b>saldo gastado</b>), importás el <b>resumen</b> del banco "
        "y lo <b>pagás</b> con su vencimiento. La tarjeta <b>no impacta tus cuentas bancarias</b>: funciona como una caja "
        "aparte con el nombre de la tarjeta; recién mueve una cuenta real cuando <b>pagás el resumen</b>.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; cargás la tarjeta &rarr; vas registrando los gastos (se suman a su "
                     "saldo) &rarr; importás el resumen del banco &rarr; lo pagás con su vencimiento (ahí sí sale la plata de una "
                     "cuenta o caja) y baja el saldo de la tarjeta.", G100, G600, G900))
    E.append(callout("<b>Dónde está:</b> menú <b>Tesorería &rarr; Bancos</b>, sección <b>\U0001F4B3 Tarjetas de crédito</b>. "
                     "Toca una tarjeta para abrir sus movimientos, cargar gastos y manejar los resúmenes. Hace falta el permiso "
                     "de <b>Finanzas</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 1 — cargar la tarjeta
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar la tarjeta", st_h2))
    E.append(steps([
        "Andá a <b>Tesorería &rarr; Bancos</b> y baja hasta <b>\U0001F4B3 Tarjetas de crédito</b>. Toca <b>+ Nueva tarjeta</b>.",
        "Completá: <b>Nombre</b> de la tarjeta (*) (ej. <i>Visa Nación</i>; es la etiqueta con la que la vas a elegir al pagar), "
        "<b>Banco emisor</b> (de la lista de Bancos del catálogo), <b>Marca</b> (Visa, Mastercard, Naranja X...), "
        "<b>Número</b> (se muestra enmascarado, solo los últimos 4), <b>Titular</b> y <b>fecha de caducidad</b>.",
        "Toca <b>\U0001F4BE Guardar</b>. La tarjeta queda disponible como medio de pago en todo el sistema y como una caja "
        "propia que podés abrir para ver sus movimientos.",
    ]))
    E.append(callout("<b>El banco importa:</b> asignarle el banco emisor te permite después <b>pagar la tarjeta desde la cuenta "
                     "bancaria de ese banco</b> (débito) y que el banco se complete solo en los gastos de la tarjeta.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 2 — gasto de tarjeta
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar un Gasto de tarjeta (ficha completa)", st_h2))
    E.append(Paragraph("Abrí la tarjeta (tocala en Bancos) y toca <b>+ Gasto de tarjeta</b>. Es la ficha de cada consumo:", st_intro))
    E.append(bullets([
        "<b>Fecha de pago</b> (*) y <b>Detalle / nombre</b> (*) (ej. <i>Combustible YPF</i>, <i>Supermercado</i>).",
        "<b>Qué se pagó (artículo):</b> podés vincularlo a una <b>Categoría de gasto</b> (así entra al reporte de Gastos por "
        "categoría), a un <b>Producto del catálogo</b>, a una <b>Cuota de crédito</b> o escribirlo como <b>texto libre</b>.",
        "<b>Monto $</b> (*), <b>Banco</b> (se completa solo según la tarjeta), <b>Intereses $</b> (si el consumo trae interés), "
        "<b>Fecha de vencimiento de pago</b> y <b>Observaciones</b>.",
    ]))
    E.append(callout("Al guardar, el gasto <b>suma al saldo gastado</b> de la tarjeta. Si le pusiste <b>categoría de gasto</b>, "
                     "aparece en el <b>Reporte de Gastos por categoría</b>. Si le pusiste <b>fecha de vencimiento</b>, "
                     "aparece solo en la <b>Agenda</b> (avisa 5 días antes).", G100, G600, G900))
    E.append(callout("En la lista de la tarjeta ves cada movimiento con su <b>monto</b>, los <b>intereses</b>, el "
                     "<b>vencimiento</b> (en rojo si ya venció) y el <b>artículo</b> pagado. El <b>✏️</b> edita y el "
                     "<b>\U0001F5D1️</b> elimina.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 3 — pagar con tarjeta en el resto del sistema
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Pagar con tarjeta en el resto del sistema", st_h2))
    E.append(Paragraph("Además de cargar gastos a mano, podés elegir la tarjeta como <b>medio de pago</b> en:", st_intro))
    E.append(bullets([
        "<b>Movimientos diarios</b>, <b>Pagos a proveedor</b> y <b>Cobros de cliente</b>, <b>Compras y Ventas</b> (condición "
        "Contado), <b>Liquidación de sueldos</b>, <b>cuotas de Crédito y Arrendamiento</b> y <b>viajes</b>.",
        "En cada caso elegís <b>\U0001F4B3 Tarjeta de crédito</b> y la tarjeta: el gasto <b>se suma a su saldo</b> igual que un "
        "Gasto de tarjeta, sin tocar tus cuentas bancarias.",
    ]))

    # PASO 4 — importar el resumen
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Importar el resumen del banco", st_h2))
    E.append(steps([
        "Abrí la tarjeta y toca <b>\U0001F4C4 Resúmenes &rarr; ⬆️ Importar resumen</b>.",
        "Subí el <b>Excel</b> que descargás del homebanking <b>o</b> el <b>PDF</b> del resumen. AgroCore lee el <b>total a "
        "pagar</b>, el <b>vencimiento</b>, el <b>cierre</b> y el <b>detalle de consumos y conceptos</b>.",
        "Revisá los datos leídos (podés corregir cualquier campo) y toca <b>\U0001F4BE Guardar resumen</b>.",
    ]))
    E.append(callout("<b>No se duplica:</b> si cargás el <b>mismo resumen</b> (aunque uno sea en Excel y otro en PDF), el sistema "
                     "lo detecta por <b>tarjeta + vencimiento + total</b> y te avisa antes de repetirlo. Si igual querés cargarlo, "
                     "aceptás; si no, cancelás.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 5 — importar/vincular los movimientos del resumen
    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Pasar los movimientos del resumen (sin duplicar)", st_h2))
    E.append(Paragraph("Al guardar un resumen con detalle, AgroCore te ofrece <b>importar sus consumos</b> como gastos de la "
                       "tarjeta, <b>vinculados</b> al resumen. Antes de crearlos, revisá que no los tengas ya cargados a mano:", st_intro))
    E.append(bullets([
        "<b>➕ Nuevo:</b> no existe &rarr; se <b>crea</b> el gasto vinculado al resumen.",
        "<b>\U0001F517 Ya existe &rarr; vincular:</b> ya lo habías cargado a mano (coincide fecha + monto) &rarr; en vez de "
        "duplicarlo, lo <b>vincula</b> a este resumen.",
        "<b>✓ Ya vinculado:</b> se deja como está.",
    ]))
    E.append(callout("Después, desde cada resumen tenés <b>\U0001F441</b> para ver <b>solo los movimientos de ese resumen</b> "
                     "(filtro) y <b>\U0001F4CB</b> para volver a importar/vincular. Lo mismo vale para los consumos en <b>dólares</b> "
                     "(ver PASO 7).", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 6 — pagar el resumen
    E.append(Paragraph("PASO 6 &nbsp;&mdash;&nbsp; Pagar el resumen", st_h2))
    E.append(steps([
        "En <b>\U0001F4C4 Resúmenes</b>, en el resumen pendiente toca <b>\U0001F4B5 Pagar</b>.",
        "<b>Parte en pesos:</b> elegí el medio (<b>Transferencia</b> o <b>Débito</b> desde una cuenta bancaria, o <b>Efectivo</b> "
        "desde una caja), la <b>fecha</b> y el <b>importe en pesos</b> (viene cargado con el total).",
        "<b>Parte en dólares</b> (si el resumen tiene U$S): elegí cómo la saldás &mdash; <b>Valorizar a pesos</b> (ponés el TC y "
        "se paga todo en $) o <b>Pagar en dólares</b> (desde una cuenta o caja en US$).",
        "Toca <b>\U0001F4BE Registrar pago</b>. Se genera el <b>egreso real</b> (banco/caja) y <b>baja el saldo gastado</b> de la "
        "tarjeta, en pesos y en dólares.",
    ]))
    E.append(callout("<b>¿Te equivocaste?</b> En el resumen pagado tenés <b>↩️ Deshacer pago</b>: borra los movimientos "
                     "generados y vuelve a dejarlo <b>pendiente</b>. El <b>\U0001F5D1️</b> elimina el resumen (si estaba "
                     "pagado, también saca esos movimientos y desvincula los gastos que ya tenías).", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 7 — dolares
    E.append(Paragraph("PASO 7 &nbsp;&mdash;&nbsp; Consumos en dólares", st_h2))
    E.append(bullets([
        "Los <b>consumos en US$</b> del resumen se cargan como movimientos en <b>dólares</b> (además de los de pesos).",
        "La pantalla de la tarjeta muestra el <b>Saldo gastado en pesos</b> y el <b>Saldo gastado en US$</b> por separado "
        "(dos columnas), y el saldo acumulado de cada fila va en su propia moneda.",
        "Al <b>pagar el resumen</b>, la parte en dólares se puede <b>valorizar a pesos</b> (con el TC del día, editable) o "
        "<b>pagar en dólares</b>. En los dos casos baja el saldo en dólares de la tarjeta.",
    ]))

    # PASO 8 — agenda
    E.append(Paragraph("PASO 8 &nbsp;&mdash;&nbsp; Vencimientos en la Agenda", st_h2))
    E.append(bullets([
        "El <b>vencimiento de un gasto de tarjeta</b> (si lo cargaste) y el <b>vencimiento de un resumen pendiente</b> aparecen "
        "solos en la <b>Agenda / Calendario</b>, con <b>aviso 5 días antes</b>.",
        "Cuando <b>pagás el resumen</b>, su vencimiento <b>desaparece solo</b> de la Agenda.",
        "Como toda alerta automática, se puede <b>ocultar</b> desde la Agenda con \U0001F5D1️ si no la querés ver (no borra "
        "el resumen ni el gasto).",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿La tarjeta mueve mis cuentas bancarias?",
         "No. La tarjeta es una caja aparte con su nombre: los gastos se suman a su 'saldo gastado'. Recién sale plata de una cuenta o caja real cuando PAGÁS el resumen (o cuando pagás la tarjeta con un débito del banco)."),
        ("Cargué el mismo resumen dos veces. ¿Cómo lo saco?",
         "El sistema te avisa cuando detecta un resumen repetido (misma tarjeta + vencimiento + total). Si igual quedó duplicado, borralo con el tacho en el panel de Resúmenes."),
        ("Importé el PDF y no traía movimientos.",
         "Actualizá a la última versión: el PDF ahora también trae el detalle de consumos y conceptos, igual que el Excel. Si el PDF es escaneado (una foto), no tiene texto para leer; en ese caso usá el Excel del homebanking."),
        ("Ya había cargado algunos consumos a mano. ¿Al importar el resumen se duplican?",
         "No. Antes de crear, el sistema revisa si ya existe un gasto con la misma fecha y monto y, en vez de duplicarlo, lo vincula al resumen. En el plan ves cuáles se crean (Nuevo) y cuáles se vinculan."),
        ("¿Cómo pago la parte en dólares del resumen?",
         "Al pagar elegís: Valorizar a pesos (ponés el tipo de cambio y pagás todo en $) o Pagar en dólares (desde una cuenta o caja en US$). En ambos casos baja el saldo en dólares de la tarjeta."),
        ("¿El vencimiento del resumen me aparece en la Agenda?",
         "Sí, mientras el resumen esté pendiente, con aviso 5 días antes. Al pagarlo desaparece solo."),
        ("¿Puedo ver solo los movimientos de un resumen?",
         "Sí: en el panel de Resúmenes, el ojo del resumen filtra la lista de la tarjeta para mostrar solo sus movimientos. 'Quitar filtro' vuelve a ver todo."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
